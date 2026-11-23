import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { setup } from './harness.ts'
import type { Config, LocalProviderProfile } from '../src/config.ts'
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS, resolveLocalProfiles } from '../src/config.ts'
import { LocalInferenceAdapter } from '../src/adapter.ts'

type FetchArgs = Parameters<typeof fetch>
interface FetchRecord { readonly url: string; readonly init?: FetchArgs[1] }

const profile = (baseURL: string, overrides: Partial<LocalProviderProfile> = {}): Config => ({
  providers: { local: { baseURL, ...overrides } },
})

function urlOf(input: FetchArgs[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function stubFetch(reply: (url: string, init?: FetchArgs[1]) => Response | Promise<Response>): FetchRecord[] {
  const requests: FetchRecord[] = []
  vi.stubGlobal('fetch', async (input: FetchArgs[0], init?: FetchArgs[1]) => {
    requests.push({ url: urlOf(input), ...(init === undefined ? {} : { init }) })
    return reply(urlOf(input), init)
  })
  return requests
}

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function sseResponse(events: readonly unknown[]): Response {
  const body = [...events.map(event => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function options(signal?: AbortSignal): GenerateOptions {
  return {
    provider: 'local', model: 'model',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
    ...(signal === undefined ? {} : { signal }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('llm-local edge behavior', () => {
  it('normalizes model catalog aliases, skips invalid ids, and uses a one-shot draft key', async () => {
    const ctx = await setup(profile('http://localhost/v1'))
    const requests = stubFetch(() => jsonResponse({ data: [
      null, [], { id: 4 }, { id: '' },
      { id: 'qwen', name: '', display_name: 'Qwen display', context_window: null, contextWindow: 8192, max_tokens: null, max_output_tokens: 1024 },
      { id: 'qwen', name: 'duplicate' },
      { id: 'other', displayName: 'Other', context_length: 4096, maxTokens: 512 },
      { id: 'bare', context_window: 0, max_tokens: 1.5 },
    ] }))

    await expect(ctx.llm.discoverModels('llm-local', {
      baseURL: 'http://catalog.test/v1', apiKey: ' draft-key ',
    })).resolves.toEqual([
      { id: 'qwen', name: 'Qwen display', inputModalities: ['text'], contextWindow: 8192, maxTokens: 1024 },
      { id: 'other', name: 'Other', inputModalities: ['text'], contextWindow: 4096, maxTokens: 512 },
      { id: 'bare', name: 'bare', inputModalities: ['text'] },
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('http://catalog.test/v1/models')
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe('Bearer draft-key')
    expect(requests[0]?.init?.redirect).toBe('error')
  })

  it('uses model ids when endpoint names are absent and overlays configured names', async () => {
    const ctx = await setup(profile('http://catalog.test/v1', {
      models: [{ id: 'named', name: 'Configured name' }],
    }))
    stubFetch(() => jsonResponse({ data: [{ id: 'named', name: 'Endpoint name' }, { id: 'bare' }] }))

    await expect(ctx.llm.listModels('local')).resolves.toEqual([
      { provider: 'local', id: 'named', name: 'Configured name', inputModalities: ['text'] },
      { provider: 'local', id: 'bare', name: 'bare', inputModalities: ['text'] },
    ])
  })

  it('rejects malformed, oversized, and unreachable catalogs with stable failures', async () => {
    const ctx = await setup(profile('http://catalog.test/v1'))
    for (const response of [
      new Response('{'),
      jsonResponse({}),
      new Response(null),
    ]) {
      stubFetch(() => response)
      await expect(ctx.llm.listModels('local')).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
    }

    stubFetch(() => new Response('x', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }))
    await expect(ctx.llm.listModels('local')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })

    stubFetch(() => new Response(new Uint8Array(4 * 1024 * 1024 + 1)))
    await expect(ctx.llm.listModels('local')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })

    stubFetch(() => { throw new Error('connection refused') })
    await expect(ctx.llm.listModels('local')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
    const aborted = new AbortController()
    aborted.abort()
    stubFetch(() => { throw new Error('request aborted') })
    await expect(ctx.llm.discoverModels('llm-local', { baseURL: 'http://catalog.test/v1' }, aborted.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('maps HTTP failures, request ids, and Retry-After values', async () => {
    const ctx = await setup(profile('http://catalog.test/v1'))
    const cases: readonly { status: number; body: string; code: string; headers?: HeadersInit }[] = [
      { status: 401, body: '{"error":{"message":"invalid key"}}', code: 'AUTH', headers: { 'x-request-id': 'request-a', 'retry-after': '1.5' } },
      { status: 403, body: 'forbidden', code: 'AUTH', headers: { 'request-id': 'request-b' } },
      { status: 402, body: '{}', code: 'QUOTA' },
      { status: 400, body: '{"error":{"code":"insufficient_quota"}}', code: 'QUOTA' },
      { status: 400, body: '{"error":{"message":"maximum context length exceeded"}}', code: 'CONTEXT_WINDOW_EXCEEDED' },
      { status: 429, body: '{"error":{"message":"slow down"}}', code: 'RATE_LIMIT' },
      { status: 400, body: '{}', code: 'INVALID_REQUEST' },
      { status: 413, body: '{}', code: 'INVALID_REQUEST' },
      { status: 500, body: '{}', code: 'SERVER' },
      { status: 418, body: '{}', code: 'HTTP_418' },
    ]
    for (const item of cases) {
      stubFetch(() => new Response(item.body, { status: item.status, ...(item.headers === undefined ? {} : { headers: item.headers }) }))
      await expect(ctx.llm.listModels('local')).rejects.toMatchObject({ code: item.code, failure: { status: item.status } })
    }

    const retryDate = new Date(Date.now() + 30_000).toUTCString()
    const retryAfter: unknown = expect.any(Number)
    stubFetch(() => new Response('{}', { status: 503, headers: { 'retry-after': retryDate } }))
    await expect(ctx.llm.listModels('local')).rejects.toMatchObject({
      code: 'SERVER', failure: { providerRetryAfterMs: retryAfter },
    })
    stubFetch(() => new Response('{}', { status: 503, headers: { 'retry-after': 'not-a-date' } }))
    await expect(ctx.llm.listModels('local')).rejects.not.toHaveProperty('failure.providerRetryAfterMs')
  })

  it('validates credential references and values before sending requests', async () => {
    expect(() => resolveLocalProfiles(profile('http://catalog.test/v1', { apiKeyEnv: 'NOT A NAME' })))
      .toThrow(/apiKeyEnv must be an environment-variable name/u)
    const missing = await setup(profile('http://catalog.test/v1', { apiKeyEnv: 'LOCAL_LLM_KEY' }))
    vi.stubEnv('LOCAL_LLM_KEY', '')
    const missingRequests = stubFetch(() => jsonResponse({ data: [] }))
    await expect(missing.llm.listModels('local')).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(missingRequests).toHaveLength(0)

    vi.stubEnv('LOCAL_LLM_KEY', '   ')
    await expect(missing.llm.listModels('local')).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
    vi.stubEnv('LOCAL_LLM_KEY', 'key\nwith-newline')
    await expect(missing.llm.listModels('local')).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('converts transport, HTTP, empty-body, malformed-SSE, abort, and idle failures to finish chunks', async () => {
    const ctx = await setup(profile('http://stream.test/v1', { streamIdleTimeoutMs: 25 }))
    stubFetch(() => { throw new Error('socket closed') })
    expect((await collect(ctx.llm.stream(options()))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT' } },
    })

    stubFetch(() => jsonResponse({ error: { message: 'invalid key' } }, 401))
    expect((await collect(ctx.llm.stream(options()))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } },
    })

    stubFetch(() => new Response(null))
    expect((await collect(ctx.llm.stream(options()))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } },
    })

    stubFetch(() => sseResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'bad-call', function: { name: 'tool', arguments: '{' } }] }, finish_reason: 'tool_calls' }] }]))
    expect((await collect(ctx.llm.stream(options()))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'MALFORMED_RESPONSE' } },
    })

    const aborted = new AbortController()
    aborted.abort()
    expect((await collect(ctx.llm.stream(options(aborted.signal)))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED' } },
    })

    stubFetch(() => new Promise<Response>(() => {}))
    expect((await collect(ctx.llm.stream(options()))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT' } },
    })
  })

  it('maps in-band HTTP and empty stream outcomes through the adapter', async () => {
    const ctx = await setup(profile('http://stream.test/v1'))
    stubFetch(() => jsonResponse({ error: { message: 'maximum context length exceeded' } }, 400))
    expect((await collect(ctx.llm.stream(options()))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } },
    })

    stubFetch(() => sseResponse([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]))
    expect((await collect(ctx.llm.stream(options()))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } },
    })

    stubFetch(() => sseResponse([{ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }]))
    expect((await collect(ctx.llm.stream(options()))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } },
    })
  })

  it('keeps the HTTP status when the failure body is oversized or broken', async () => {
    const ctx = await setup(profile('http://catalog.test/v1'))
    stubFetch(() => new Response('x'.repeat(64 * 1024), { status: 500 }))
    await expect(ctx.llm.listModels('local')).rejects.toMatchObject({
      code: 'SERVER', message: expect.stringMatching(/HTTP 500/u) as string,
    })

    const broken = new ReadableStream({ start(controller) { controller.error(new Error('mid-read failure')) } })
    stubFetch(() => new Response(broken, { status: 503 }))
    await expect(ctx.llm.listModels('local')).rejects.toMatchObject({ code: 'SERVER' })
  })

  it('preserves the bounded-read outcome when stream cancellation refuses', async () => {
    const ctx = await setup(profile('http://catalog.test/v1'))
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)) },
      cancel() { return Promise.reject(new Error('cancel refused')) },
    })
    stubFetch(() => new Response(body))
    await expect(ctx.llm.listModels('local')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
  })

  it('reports caller cancellation while a listing body is read', async () => {
    const ctx = await setup(profile('http://catalog.test/v1'))
    const controller = new AbortController()
    let failRead: ((error: Error) => void) | undefined
    const body = new ReadableStream({ start(stream) { failRead = (error: Error) => { stream.error(error) } } })
    stubFetch(() => new Response(body))
    const pending = ctx.llm.discoverModels('llm-local', { baseURL: 'http://catalog.test/v1' }, controller.signal)
    controller.abort()
    failRead?.(new Error('read aborted'))
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('validates discovery endpoints and interrogates a configured route', async () => {
    vi.stubEnv('LOCAL_LLM_KEY', 'routed-key')
    const ctx = await setup(profile('http://catalog.test/v1', { apiKeyEnv: 'LOCAL_LLM_KEY' }))
    await expect(ctx.llm.discoverModels('llm-local', { baseURL: 'not a url' }))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
    await expect(ctx.llm.discoverModels('llm-local', { baseURL: 'ftp://catalog.test/v1' }))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
    await expect(ctx.llm.discoverModels('llm-local', { baseURL: 'http://user:secret@catalog.test/v1' }))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })

    const requests = stubFetch(() => jsonResponse({ data: [{ id: 'routed' }] }))
    await expect(ctx.llm.discoverModels('llm-local', { provider: 'local' })).resolves.toEqual([
      { id: 'routed', name: 'routed', inputModalities: ['text'] },
    ])
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe('Bearer routed-key')
  })

  it('answers route facts directly and refuses unknown routes', async () => {
    const ctx = await setup(profile('http://catalog.test/v1'))
    const profiles = resolveLocalProfiles(profile('http://catalog.test/v1', { retryPolicy: { mode: 'normal', maxRetries: 1 } }))
    const adapter = new LocalInferenceAdapter(profiles, ctx)
    expect(adapter.providerInfo('local')).toEqual({ id: 'local', name: 'local' })
    expect(adapter.providerRetryPolicy('local')).toMatchObject({ mode: 'normal', maxRetries: 1 })
    expect(() => adapter.providerInfo('missing')).toThrow(/no route/u)
    await expect(adapter.discoverModels({})).rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
  })

  it('applies defaults to direct configuration and rejects malformed ids', () => {
    expect(() => resolveLocalProfiles({ providers: { '': { baseURL: 'http://x.test/v1' } } }))
      .toThrow(/provider ids/u)
    expect(() => resolveLocalProfiles(profile('not a url'))).toThrow(/absolute HTTP/u)
    expect(resolveLocalProfiles(profile('http://x.test/v1')).get('local')).toMatchObject({
      displayName: 'local', streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    })
  })
})
