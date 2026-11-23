/** OpenAI-compatible local inference transport and model discovery. */

import { brandString } from '@deepseek-ai/dsh-brand'
import { normalizeApiKey, resolveCredentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import { attributionHeaders, isContextWindowExceededError, isQuotaExceededError, LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { BuiltinLlmFailureCode, GenerateOptions, LlmDiscoveredModel, LlmModelDiscoveryRequest, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, ProviderRequestId, StreamChunk } from '@deepseek-ai/dsh-llm'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ResolvedLocalProviderProfile } from './config.ts'
import { readChatStream } from './stream.ts'
import { serializeChatRequest } from './messages.ts'

const MAX_LISTING_BYTES = 4 * 1024 * 1024
const MAX_ERROR_BYTES = 16 * 1024

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function label(...values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0)
}

/* jscpd:ignore-start -- deliberate symmetry with llm-pi-ai's bounded discovery
   read: both loops enforce the same mid-stream byte cap, while limits, error
   codes, and failure wrapping differ per provider. */
/** Read a bounded response body, refusing a server that streams past its declared listing limit. */
async function readBounded(response: Response, limit: number, url: string): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel()
    throw new LlmError(`llm-local: ${url} returned more than ${limit} bytes`, 'DISCOVERY_FAILED')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) throw new LlmError(`llm-local: ${url} returned more than ${limit} bytes`, 'DISCOVERY_FAILED')
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof LlmError) throw error
    throw new LlmError(`llm-local: ${url} response body failed to read`, 'DISCOVERY_FAILED', { cause: error })
  } finally {
    await reader.cancel().catch((_cancelError: unknown) => {
      // Preserve the read result; cancellation only releases this bounded reader.
    })
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
/* jscpd:ignore-end */

/** Read an HTTP failure body for its message, keeping the status authoritative when the body is unusable. */
async function readErrorBody(response: Response, url: string): Promise<string> {
  try { return await readBounded(response, MAX_ERROR_BYTES, url) } catch (_unreadableError) {
    // The status alone still identifies the failure when the body is oversized or broken.
    return ''
  }
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after')
  if (value === null) return undefined
  const milliseconds = /^\d+(?:\.\d+)?$/u.test(value) ? Number(value) * 1_000 : Date.parse(value) - Date.now()
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined
}

function httpError(status: number, headers: Headers, body: string): LlmError {
  let detail = ''
  let message = `local inference endpoint returned HTTP ${status}`
  let errorPayload: Record<string, unknown> | undefined
  try { errorPayload = object(object(JSON.parse(body))?.error) } catch (_nonJsonErrorBody) {
    // Status remains authoritative when a local gateway returns plain text.
  }
  if (errorPayload !== undefined) {
    detail = [errorPayload.code, errorPayload.type, errorPayload.message]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
    message = label(errorPayload.message) ?? message
  }
  const code: BuiltinLlmFailureCode = status === 401 || status === 403 ? 'AUTH'
    : isQuotaExceededError(detail) || status === 402 ? 'QUOTA'
      : status === 429 ? 'RATE_LIMIT'
        : isContextWindowExceededError(detail) ? 'CONTEXT_WINDOW_EXCEEDED'
          : status === 400 || status === 413 ? 'INVALID_REQUEST'
            : status >= 500 ? 'SERVER'
              : `HTTP_${status}`
  const requestId = headers.get('x-request-id') ?? headers.get('request-id')
  const delay = retryAfterMs(headers)
  return new LlmError(`llm-local: ${message}`, code, {
    status,
    ...requestId === null || requestId.length === 0 ? {} : { requestId: brandString<ProviderRequestId>(requestId) },
    ...delay === undefined ? {} : { providerRetryAfterMs: delay },
  })
}

/** Endpoint-advertised model whose display name already carries the id fallback. */
interface ListedModel extends LlmDiscoveredModel {
  readonly name: string
}

function parseModelListing(raw: unknown): ListedModel[] {
  const data = object(raw)?.data
  if (!Array.isArray(data)) throw new LlmError('llm-local: model listing has no data array', 'MALFORMED_RESPONSE')
  const discovered: ListedModel[] = []
  const seen = new Set<string>()
  for (const item of data) {
    const entry = object(item)
    const id = label(entry?.id)
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const contextWindow = positiveInteger(entry?.context_window ?? entry?.contextWindow ?? entry?.context_length)
    const maxTokens = positiveInteger(entry?.max_tokens ?? entry?.max_output_tokens ?? entry?.maxTokens)
    discovered.push({
      id,
      name: label(entry?.name, entry?.display_name, entry?.displayName) ?? id,
      inputModalities: ['text'],
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return discovered
}

function mergeModel(profile: ResolvedLocalProviderProfile, model: ListedModel): LlmModelInfo {
  const configured = profile.models.get(model.id)
  return {
    provider: profile.provider,
    id: model.id,
    name: configured?.name ?? model.name,
    inputModalities: ['text'],
  }
}

/** A direct-fetch adapter for configured local OpenAI-compatible routes. */
export class LocalInferenceAdapter extends LlmAdapter {
  constructor(
    private readonly profiles: ReadonlyMap<string, ResolvedLocalProviderProfile>,
    private readonly ctx: Context,
  ) {
    super()
  }

  /**
   * Describe one route for provider selectors.
   * @param provider - route id owned by this adapter.
   * @returns the route id and configured display label.
   */
  override providerInfo(provider: string) {
    const profile = this.profile(provider)
    return { id: provider, name: profile.displayName }
  }

  /**
   * Resolve the route's retry policy for registration.
   * @param provider - route id whose policy was captured at registration.
   * @returns the configured policy, or `undefined` to use runtime defaults.
   */
  override providerRetryPolicy(provider: string) {
    const policy = this.profile(provider).retryPolicy
    return policy === undefined ? undefined : resolveRetryPolicy(policy, `llm-local: provider "${provider}" retryPolicy`)
  }

  /**
   * Query the current endpoint catalog for one active route.
   * @param provider - registered route id.
   * @returns current endpoint models with configured metadata overlaid.
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const profile = this.profile(provider)
    return (await this.fetchModels(profile, profile.baseURL, undefined)).map(model => mergeModel(profile, model))
  }

  /**
   * Resolve metadata for an exact model id without requiring catalog membership.
   * @param provider - registered route id.
   * @param model - model id used in requests.
   * @param _signal - caller cancellation; no network lookup is required.
   * @returns exact-route metadata and configured capacities when present.
   */
  override resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const profile = this.profile(provider)
    const configured = profile.models.get(model)
    return Promise.resolve({
      provider,
      id: model,
      name: configured?.name ?? model,
      inputModalities: ['text'],
      ...configured?.contextWindow === undefined ? {} : { context: { contextWindow: configured.contextWindow } },
      ...configured?.maxTokens === undefined ? {} : { defaultMaxTokens: configured.maxTokens },
    })
  }

  /**
   * Capture route metadata and dispatch through the same adapter instance.
   * @param provider - registered route id.
   * @param model - model id used in requests.
   * @param signal - caller cancellation for exact-model resolution.
   * @returns resolved metadata and a stream bound to this adapter generation.
   */
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) }
  }

  /**
   * Stream one request to the endpoint selected by its provider route.
   * @param options - fully assembled request; caller cancellation aborts fetch and parsing.
   * @returns OpenAI-compatible SSE events translated into harness chunks.
   */
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.generate(options)
  }

  /**
   * Interrogate one draft endpoint or configured route for its model ids.
   * @param request - endpoint draft, optionally naming a configured route and key.
   * @param signal - caller cancellation.
   * @returns models advertised by the endpoint.
   */
  async discoverModels(request: LlmModelDiscoveryRequest, signal?: AbortSignal): Promise<readonly LlmDiscoveredModel[]> {
    const profile = request.provider === undefined ? undefined : this.profiles.get(request.provider)
    const baseURL = request.baseURL ?? profile?.baseURL
    if (baseURL === undefined) throw new LlmError('llm-local model discovery needs a provider route or baseURL', 'INVALID_DISCOVERY')
    const endpoint = resolveDiscoveryBaseURL(baseURL)
    const key = request.apiKey !== undefined
      ? usableApiKey(request.apiKey)
      : profile === undefined ? undefined : await this.apiKey(profile)
    const models = await this.fetchModels(profile, endpoint, key, signal)
    return models
  }

  private profile(provider: string): ResolvedLocalProviderProfile {
    const profile = this.profiles.get(provider)
    if (profile === undefined) throw new LlmError(`llm-local has no route "${provider}"`, 'NO_ADAPTER')
    return profile
  }

  private async apiKey(profile: ResolvedLocalProviderProfile): Promise<string | undefined> {
    if (profile.apiKeyEnv === undefined) return undefined
    const value = await resolveCredentialRef(this.ctx, profile.apiKeyEnv)
    if (value === undefined) {
      throw new LlmError(`llm-local: no credential resolves from ${profile.apiKeyEnv} for route "${profile.provider}"`, 'MISSING_CREDENTIAL')
    }
    return usableApiKey(value)
  }

  private async headers(profile: ResolvedLocalProviderProfile, apiKey?: string): Promise<Headers> {
    const key = apiKey ?? await this.apiKey(profile)
    const headers = new Headers(attributionHeaders())
    headers.set('accept', 'text/event-stream, application/json')
    headers.set('content-type', 'application/json')
    if (key !== undefined) headers.set('authorization', `Bearer ${key}`)
    return headers
  }

  private async fetchModels(
    profile: ResolvedLocalProviderProfile | undefined,
    baseURL: string,
    apiKey: string | undefined,
    signal?: AbortSignal,
  ): Promise<ListedModel[]> {
    const url = `${baseURL.replace(/\/+$/u, '')}/models`
    const headers = profile === undefined
      ? new Headers(attributionHeaders())
      : await this.headers(profile, apiKey)
    headers.set('accept', 'application/json')
    if (profile === undefined && apiKey !== undefined) headers.set('authorization', `Bearer ${apiKey}`)
    let response: Response
    try {
      response = await fetch(url, { method: 'GET', headers, redirect: 'error', ...signal === undefined ? {} : { signal } })
    } catch (error) {
      if (signal?.aborted) throw new LlmError('llm-local model discovery aborted', 'ABORTED', { cause: error })
      throw new LlmError(`llm-local could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
    }
    if (!response.ok) {
      const body = await readErrorBody(response, url)
      throw httpError(response.status, response.headers, body)
    }
    let text: string
    try { text = await readBounded(response, MAX_LISTING_BYTES, url) } catch (error) {
      if (signal?.aborted) throw new LlmError('llm-local model discovery aborted', 'ABORTED', { cause: error })
      throw error
    }
    let raw: unknown
    try { raw = JSON.parse(text) } catch (error) {
      throw new LlmError(`llm-local ${url} did not return valid JSON`, 'MALFORMED_RESPONSE', { cause: error })
    }
    return parseModelListing(raw)
  }

  private async * generate(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const profile = this.profile(options.provider)
    const controller = new AbortController()
    using watchdog = idleWatchdog(options.signal, profile.streamIdleTimeoutMs, 'LOCAL_INFERENCE_IDLE')
    const signal = AbortSignal.any([controller.signal, watchdog.signal])
    let iterator: AsyncGenerator<StreamChunk> | undefined
    try {
      signal.throwIfAborted()
      const headers = await this.headers(profile)
      const events = async function* (): AsyncGenerator<StreamChunk> {
        const response = await fetch(`${profile.baseURL}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(serializeChatRequest(options)),
          signal,
          redirect: 'error',
        })
        if (!response.ok) {
          const body = await readErrorBody(response, `${profile.baseURL}/chat/completions`)
          throw httpError(response.status, response.headers, body)
        }
        if (response.body === null) throw new LlmError('llm-local response has no body', 'EMPTY_RESPONSE')
        yield* readChatStream(response.body, () => { watchdog.pulse() })
      }
      iterator = events()
      while (true) {
        const next = await watchdog.next(iterator)
        if (next.done) return
        yield next.value
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, 'LOCAL_INFERENCE_IDLE') !== undefined) {
        throw new LlmError('llm-local stream idle timeout', 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) throw new LlmError('llm-local request aborted', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError('llm-local transport failed', 'TRANSPORT', { cause: error })
    } finally {
      controller.abort()
      if (iterator !== undefined) {
        // The abort above owns the socket teardown. A demand the deadline abandoned
        // can stay pending forever, and this generator queues its own return behind
        // that demand, so awaiting the drain would re-hang the settled outcome.
        /* v8 ignore next -- the detached drain only rejects while unwinding an abandoned request. */
        void iterator.return(undefined).catch(() => {})
      }
    }
  }
}

function usableApiKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'llm-local API key is blank; set the configured credential reference or clear apiKeyEnv'
      : 'llm-local API key contains characters that cannot be sent in an HTTP header',
    'INVALID_CREDENTIAL',
  )
}

function resolveDiscoveryBaseURL(value: string): string {
  let url: URL
  try { url = new URL(value) } catch (error) {
    throw new LlmError('llm-local model discovery baseURL must be an absolute HTTP(S) URL', 'INVALID_DISCOVERY', { cause: error })
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
    throw new LlmError('llm-local model discovery baseURL must use HTTP(S) without credentials, query, or fragment', 'INVALID_DISCOVERY')
  }
  return value.replace(/\/+$/u, '')
}
