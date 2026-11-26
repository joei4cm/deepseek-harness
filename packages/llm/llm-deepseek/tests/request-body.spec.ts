/** The Messages request body carries only well-formed text. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { RequestMessage } from '@deepseek-ai/dsh-llm'
import { adapter, assemble, MODEL, options, sse, textEvents } from './helpers.ts'

/** A lone high surrogate, as model-written code produces by slicing a pair. */
const LONE_HIGH = '\uD83D'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** History whose tool result ends with the given text. */
function history(text: string): RequestMessage[] {
  return [
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'run it' }] }),
    createAssistantMessage({
      content: [{ type: 'tool-call', id: ToolCallId('call_1'), name: 'read', arguments: '{}' }],
      source: { provider: 'deepseek-official', model: MODEL },
    }),
    createToolResultMessage({ callId: ToolCallId('call_1'), content: [{ type: 'text', text }], isError: false }),
  ]
}

/** Send one request whose tool result carries `text` and return the request body. */
async function sentBody(text: string): Promise<string> {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(sse(textEvents)))
  vi.stubGlobal('fetch', fetch)
  const result = await assemble(adapter().stream(options({ messages: history(text) })))
  expect(result.assembler.finish.kind).toBe('stop')
  const body = fetch.mock.calls[0]?.[1]?.body
  if (typeof body !== 'string') throw new Error('Expected a serialized Messages request')
  return body
}

describe('Messages request body', () => {
  it('sends a tool result that ends with a lone surrogate without an unpaired escape', async () => {
    const body = await sentBody(`out${LONE_HIGH}`)
    expect(body).not.toContain('\\ud83d')
    expect(body).toContain('out�')
  })

  it('keeps a complete astral character in the same text unchanged', async () => {
    const body = await sentBody('out😲')
    expect(body).not.toContain('�')
    expect(body).toContain('out😲')
  })
})
