import { afterEach, describe, expect, it } from 'vitest'
import type { MockOpenAiServer } from '../src/index.ts'
import { startMockOpenAiServer } from '../src/index.ts'

const running: MockOpenAiServer[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map(server => server.close()))
})

async function start(options: Parameters<typeof startMockOpenAiServer>[0]): Promise<MockOpenAiServer> {
  const server = await startMockOpenAiServer(options)
  running.push(server)
  return server
}

describe('mock OpenAI-compatible server', () => {
  it('advertises models keylessly at the standard endpoint', async () => {
    const server = await start({
      models: [{ id: 'qwen-local', name: 'Qwen local', contextWindow: 8192, maxTokens: 1024 }],
    })
    const response = await fetch(`${server.baseURL}/v1/models`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'list',
      data: [{
        id: 'qwen-local', object: 'model', name: 'Qwen local', context_window: 8192, max_tokens: 1024,
      }],
    })
    expect(server.requests).toMatchObject([{ method: 'GET', path: '/v1/models' }])
    expect(server.requests[0]?.headers.authorization).toBeUndefined()
  })

  it('requires an exact Bearer key and streams captured Chat Completions', async () => {
    const server = await start({
      apiKey: 'test-key',
      models: [{ id: 'qwen-local' }],
      completion: {
        content: 'ready', reasoning: 'check',
        toolCalls: [{ id: 'call-1', name: 'inspect', arguments: '{"path":"."}' }],
        promptTokens: 5, completionTokens: 3,
      },
    })
    const rejected = await fetch(`${server.baseURL}/v1/models`)
    expect(rejected.status).toBe(401)
    expect(server.requests).toHaveLength(0)

    const response = await fetch(`${server.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'qwen-local', stream: true }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(body).toContain('"reasoning_content":"check"')
    expect(body).toContain('"content":"ready"')
    expect(body).toContain('"arguments":"{\\"pat"')
    expect(body).toContain('"arguments":"h\\":\\"."')
    expect(body).toContain('"arguments":"\\"}"')
    expect(body).toContain('"prompt_tokens":5')
    expect(body).toContain('data: [DONE]')
    const capturedHeaders: unknown = expect.objectContaining({ authorization: 'Bearer test-key' })
    expect(server.requests).toEqual([expect.objectContaining({
      method: 'POST', path: '/v1/chat/completions',
      headers: capturedHeaders,
      body: { model: 'qwen-local', stream: true },
    })])
  })

  it('omits absent model metadata and serves a default keyless completion', async () => {
    const server = await start({ models: [{ id: 'qwen-local' }] })
    const listing = await fetch(`${server.baseURL}/v1/models`)
    await expect(listing.json()).resolves.toEqual({
      object: 'list', data: [{ id: 'qwen-local', object: 'model' }],
    })

    const completion = await fetch(`${server.baseURL}/v1/chat/completions`, {
      method: 'POST', body: JSON.stringify({ model: 'qwen-local', stream: true }),
    })
    const body = await completion.text()
    expect(body).toContain('"content":"mock "')
    expect(body).toContain('"content":"respo"')
    expect(body).toContain('"finish_reason":"stop"')
    expect(body).toContain('"prompt_tokens":11')
    expect(body).toContain('"completion_tokens":7')
  })

  it('streams a tool-only completion with inferred reason and default usage', async () => {
    const server = await start({
      models: [{ id: 'qwen-local' }],
      completion: { toolCalls: [{ id: 'call-1', name: 'inspect', arguments: '' }] },
    })
    const response = await fetch(`${server.baseURL}/v1/chat/completions`, {
      method: 'POST', body: JSON.stringify({ model: 'qwen-local', stream: true }),
    })
    const body = await response.text()

    expect(body).not.toContain('reasoning_content')
    expect(body).not.toContain('"content":')
    expect(body).toContain('"function":{"name":"inspect","arguments":""}')
    expect(body).toContain('"finish_reason":"tool_calls"')
    expect(body).toContain('"prompt_tokens":11')
    expect(body).toContain('"total_tokens":18')
  })

  it('rejects invalid and oversized request bodies and unknown routes', async () => {
    const server = await start({ models: [{ id: 'qwen-local' }] })
    const invalid = await fetch(`${server.baseURL}/v1/chat/completions`, { method: 'POST', body: 'not json' })
    expect(invalid.status).toBe(400)

    const oversized = await fetch(`${server.baseURL}/v1/chat/completions`, {
      method: 'POST', body: 'x'.repeat(1024 * 1024 + 1),
    })
    expect(oversized.status).toBe(400)

    const unknown = await fetch(`${server.baseURL}/nope`)
    expect(unknown.status).toBe(404)
    expect(server.requests).toHaveLength(0)
  })

  it('validates its own options and advertises an IPv6 listener', async () => {
    await expect(startMockOpenAiServer({ models: [], host: '' })).rejects.toThrow(/host/u)
    await expect(startMockOpenAiServer({ models: [], port: -1 })).rejects.toThrow(/port/u)
    await expect(startMockOpenAiServer({ models: [], port: 70_000 })).rejects.toThrow(/port/u)
    await expect(startMockOpenAiServer({ models: [], apiKey: '' })).rejects.toThrow(/apiKey/u)

    const server = await start({ models: [], host: '::1' })
    expect(server.baseURL).toMatch(/^http:\/\/\[::1\]:\d+$/u)
  })
})
