/** The pi-ai request context carries only well-formed text. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

const streamSimple = vi.hoisted(() => vi.fn())

// A hand-declared route is built by `createProvider` over the protocol table in
// `src/provider.ts`, so the table's lazy api module is the SDK boundary this
// test can observe.
vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: () => ({ stream: streamSimple, streamSimple }),
}))

import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

/** A lone high surrogate, as model-written code produces by slicing a pair. */
const LONE_HIGH = '\uD83D'

afterEach(() => {
  streamSimple.mockReset()
})

/** A hand-declared OpenAI-compatible route with one fully described model. */
function gatewayAdapter(): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles({
      'local-gateway': {
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:9/v1',
        models: [{ id: 'local-model', contextWindow: 8192, maxTokens: 1024 }],
      },
    }),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
  })
}

/** Send one request whose user text is `text` and return the serialized context. */
async function sentContext(text: string): Promise<string> {
  streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })
  const chunks: StreamChunk[] = []
  const adapter = gatewayAdapter()
  for await (const chunk of adapter.stream({
    provider: 'local-gateway',
    model: 'local-model',
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })],
  })) chunks.push(chunk)
  expect(streamSimple).toHaveBeenCalledOnce()
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
  return JSON.stringify(streamSimple.mock.calls[0]?.[1])
}

describe('pi-ai request context', () => {
  it('sends text that ends with a lone surrogate without an unpaired escape', async () => {
    const context = await sentContext(`out${LONE_HIGH}`)
    expect(context).not.toContain('\\ud83d')
    expect(context).toContain('out�')
  })

  it('keeps a complete astral character in the same text unchanged', async () => {
    const context = await sentContext('out😲')
    expect(context).not.toContain('�')
    expect(context).toContain('out😲')
  })
})
