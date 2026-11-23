/** Validated local inference routes and model metadata. */

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

/** Default maximum idle time while one provider response read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** One model's optional selector metadata for a local endpoint. */
export interface LocalModelProfile {
  /** Exact model id accepted by the endpoint. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Combined request and response context capacity when known. */
  contextWindow?: number
  /** Per-request output cap when known. */
  maxTokens?: number
}

/** Connection and authentication settings for one OpenAI-compatible route. */
export interface LocalProviderProfile {
  /** HTTP(S) API root, usually ending in `/v1`. */
  baseURL: string
  /** Selector label; defaults to the provider route id. */
  displayName?: string
  /** Credential reference resolved for each operation; omission sends no auth header. */
  apiKeyEnv?: string
  /** Optional known model metadata overlaid on endpoint discovery. */
  models?: LocalModelProfile[]
  /** Maximum provider idle interval per response read. */
  streamIdleTimeoutMs?: number
  /** Provider-owned retry policy; omission uses the LLM runtime defaults. */
  retryPolicy?: RetryPolicyConfig
}

/** Plugin configuration keyed by the provider route selected in model requests. */
export interface Config {
  /** Every configured endpoint route. At least one route is required. */
  providers: Record<string, LocalProviderProfile>
}

const positiveInteger = z.natural().min(1)

const ModelProfileSchema: z<LocalModelProfile> = z.object({
  id: z.string().min(1).required(),
  name: z.string().min(1),
  contextWindow: positiveInteger,
  maxTokens: positiveInteger,
})

const ProviderProfileSchema: z<LocalProviderProfile> = z.object({
  baseURL: z.string().min(1).required(),
  displayName: z.string().min(1),
  apiKeyEnv: z.string().min(1),
  models: z.array(ModelProfileSchema),
  streamIdleTimeoutMs: positiveInteger.default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

/** Schemastery schema used by the Cordis plugin loader. */
export const Config: z<Config> = z.object({
  providers: z.dict(ProviderProfileSchema).required(),
})

/** Resolved connection facts captured for each provider route. */
export interface ResolvedLocalProviderProfile {
  /** Route id used in GenerateOptions. */
  readonly provider: string
  /** Display label shown by model selectors. */
  readonly displayName: string
  /** Validated API root without trailing slashes. */
  readonly baseURL: string
  /** Validated credential reference, when configured. */
  readonly apiKeyEnv?: CredentialRef
  /** User-declared model metadata indexed by exact endpoint id. */
  readonly models: ReadonlyMap<string, LocalModelProfile>
  /** Provider idle interval for HTTP headers and SSE reads. */
  readonly streamIdleTimeoutMs: number
  /** Retry policy captured when routes are registered. */
  readonly retryPolicy?: RetryPolicyConfig
}

/**
 * Resolve and validate plugin routes before any registration takes effect.
 * @param config - loader-validated local adapter configuration.
 * @returns immutable route facts indexed by provider id.
 * @throws LlmError `INVALID_CONFIG` for an empty route set, malformed endpoint, or duplicate model id.
 */
export function resolveLocalProfiles(config: Config): ReadonlyMap<string, ResolvedLocalProviderProfile> {
  const entries = Object.entries(config.providers)
  if (entries.length === 0) throw new LlmError('llm-local requires at least one provider route', 'INVALID_CONFIG')
  const profiles = new Map<string, ResolvedLocalProviderProfile>()
  for (const [provider, profile] of entries) {
    if (provider.length === 0) throw new LlmError('llm-local provider ids must not be empty', 'INVALID_CONFIG')
    const baseURL = resolveBaseURL(profile.baseURL, provider)
    const models = new Map<string, LocalModelProfile>()
    for (const model of profile.models ?? []) {
      if (models.has(model.id)) {
        throw new LlmError(`llm-local provider "${provider}" repeats model id "${model.id}"`, 'INVALID_CONFIG')
      }
      models.set(model.id, Object.freeze({ ...model }))
    }
    let apiKeyEnv: CredentialRef | undefined
    if (profile.apiKeyEnv !== undefined) {
      try { apiKeyEnv = credentialRef(profile.apiKeyEnv) } catch (error) {
        throw new LlmError(`llm-local provider "${provider}" apiKeyEnv must be an environment-variable name`, 'INVALID_CONFIG', { cause: error })
      }
    }
    profiles.set(provider, Object.freeze({
      provider,
      displayName: profile.displayName ?? provider,
      baseURL,
      ...apiKeyEnv === undefined ? {} : { apiKeyEnv },
      models,
      streamIdleTimeoutMs: profile.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      ...profile.retryPolicy === undefined ? {} : { retryPolicy: profile.retryPolicy },
    }))
  }
  return profiles
}

/**
 * Validate one API root without rewriting its configured path.
 * @param value - configured HTTP(S) endpoint root.
 * @param provider - route named in a validation failure.
 * @returns the URL without trailing slashes.
 * @throws LlmError `INVALID_CONFIG` when the URL cannot safely carry a request.
 */
export function resolveBaseURL(value: string, provider: string): string {
  let url: URL
  try { url = new URL(value) } catch (error) {
    throw new LlmError(`llm-local provider "${provider}" baseURL must be an absolute HTTP(S) URL`, 'INVALID_CONFIG', { cause: error })
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username.length > 0 || url.password.length > 0
    || url.search.length > 0 || url.hash.length > 0) {
    throw new LlmError(`llm-local provider "${provider}" baseURL must use HTTP(S) without credentials, query, or fragment`, 'INVALID_CONFIG')
  }
  return value.replace(/\/+$/u, '')
}
