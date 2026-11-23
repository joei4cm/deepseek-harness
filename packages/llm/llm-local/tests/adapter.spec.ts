import { afterEach, describe, expect, it, vi } from 'vitest'
import { startMockOpenAiServer } from '@deepseek-ai/dsh-llm-mock-server'
import { setup } from './harness.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { LocalProviderProfile, Config } from '../src/config.ts'
import { createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { resolveLocalProfiles } from '../src/config.ts'

let server: Awaited<ReturnType<typeof startMockOpenAiServer>> | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const profile = (baseURL: string, overrides: Partial<LocalProviderProfile> = {}): Config => ({
  providers: { local: { baseURL, ...overrides } },
})

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('llm-local', () => {
  it('lists models keylessly and overlays configured selector metadata', async () => {
    server = await startMockOpenAiServer({ models: [{ id: 'qwen-local', name: 'Qwen from server' }] })
    const ctx = await setup(profile(`${server.baseURL}/v1`, {
      displayName: 'Intel inference',
      models: [{ id: 'qwen-local', name: 'Qwen local', contextWindow: 32768, maxTokens: 4096 }],
    }))

    expect(ctx.llm.listProviders()).toEqual([{ id: 'local', name: 'Intel inference' }])
    await expect(ctx.llm.listModels('local')).resolves.toEqual([{
      provider: 'local', id: 'qwen-local', name: 'Qwen local', inputModalities: ['text'],
    }])
    expect(server.requests[0]?.headers.authorization).toBeUndefined()
    expect(server.requests[0]?.path).toBe('/v1/models')
  })

  it('streams text, usage, and a function call through the harness vocabulary', async () => {
    server = await startMockOpenAiServer({
      models: [{ id: 'qwen-local' }],
      completion: {
        content: 'ready',
        reasoning: 'check inputs',
        toolCalls: [{ id: 'call-1', name: 'inspect', arguments: '{"path":"."}' }],
      },
    })
    const ctx = await setup(profile(`${server.baseURL}/v1`, { models: [{ id: 'qwen-local', contextWindow: 32768, maxTokens: 4096 }] }))
    const oldCallId = brandString<ToolCallId>('old-call')
    const options: GenerateOptions = {
      provider: 'local', model: 'qwen-local',
      messages: [
        createSystemMessage('rules'),
        createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }),
        createAssistantMessage({
          content: [
            { type: 'reasoning', text: 'old thought' },
            { type: 'tool-call', id: oldCallId, name: 'inspect', arguments: '{"path":"old"}' },
          ],
          source: { provider: 'local', model: 'qwen-local' },
        }),
        createToolResultMessage({ callId: oldCallId, content: [{ type: 'text', text: 'found' }], isError: false }),
      ],
      tools: [{ name: 'inspect', description: 'Inspect a path', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
      maxTokens: 128, temperature: 0.2, stop: ['END'],
    }
    const chunks = await collect(ctx.llm.stream(options))
    expect(chunks.filter(chunk => chunk.type === 'block-start').map(chunk => chunk.blockType)).toEqual([
      'reasoning', 'text', 'tool-call',
    ])
    expect(chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.index)).toEqual([0, 1, 2])
    expect(chunks.filter(chunk => chunk.type === 'reasoning-delta')).toHaveLength(3)
    expect(chunks.filter(chunk => chunk.type === 'text-delta')).toHaveLength(1)
    expect(chunks.filter(chunk => chunk.type === 'tool-call-delta')).toHaveLength(3)
    expect(chunks.at(-2)).toMatchObject({ type: 'usage', usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(server.requests[0]?.path).toBe('/v1/chat/completions')
    expect(server.requests[0]?.body).toMatchObject({
      model: 'qwen-local', stream: true, max_tokens: 128, temperature: 0.2, stop: ['END'],
      stream_options: { include_usage: true },
      tools: [{ type: 'function', function: { name: 'inspect' } }],
    })
  })

  it('resolves configured model capacities and keeps unknown models requestable', async () => {
    server = await startMockOpenAiServer({ models: [{ id: 'configured' }] })
    const ctx = await setup(profile(`${server.baseURL}/v1`, { models: [{ id: 'configured', contextWindow: 8192, maxTokens: 1024 }] }))
    await expect(ctx.llm.resolveModelInfo('local', 'configured')).resolves.toMatchObject({
      provider: 'local', id: 'configured', context: { contextWindow: 8192 }, defaultMaxTokens: 1024,
    })
    await expect(ctx.llm.resolveModelInfo('local', 'not-listed')).resolves.toMatchObject({ id: 'not-listed', name: 'not-listed' })
  })

  it('supports standalone endpoint discovery without credentials', async () => {
    server = await startMockOpenAiServer({ models: [{ id: 'candidate', contextWindow: 4096, maxTokens: 512 }] })
    const ctx = await setup(profile(`${server.baseURL}/v1`))
    await expect(ctx.llm.discoverModels('llm-local', { baseURL: `${server.baseURL}/v1` })).resolves.toEqual([{
      id: 'candidate', name: 'candidate', inputModalities: ['text'], contextWindow: 4096, maxTokens: 512,
    }])
  })

  it('sends an explicitly configured API key and reports HTTP status failures', async () => {
    server = await startMockOpenAiServer({ apiKey: 'local-key', models: [{ id: 'qwen-local' }], completion: { content: 'ok' } })
    vi.stubEnv('LOCAL_LLM_KEY', ' local-key ')
    const ctx = await setup(profile(`${server.baseURL}/v1`, { apiKeyEnv: 'LOCAL_LLM_KEY' }))
    expect(await ctx.llm.listModels('local')).toHaveLength(1)
    const chunks = await collect(ctx.llm.stream({
      provider: 'local', model: 'qwen-local',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
    }))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(server.requests.every(request => request.headers.authorization === 'Bearer local-key')).toBe(true)
  })

  it('rejects route and URL configuration errors before registration', () => {
    expect(() => resolveLocalProfiles({ providers: {} })).toThrow(/at least one provider route/u)
    expect(() => resolveLocalProfiles(profile('file:///tmp/local'))).toThrow(/HTTP\(S\)/u)
    expect(() => resolveLocalProfiles(profile('http://user:local-secret@localhost/v1'))).toThrow(/without credentials/u)
    expect(() => resolveLocalProfiles(profile('http://localhost/v1?token=x'))).toThrow(/without credentials/u)
    expect(() => resolveLocalProfiles(profile('http://localhost/v1', { models: [{ id: 'same' }, { id: 'same' }] }))).toThrow(/repeats model id/u)
  })
})
