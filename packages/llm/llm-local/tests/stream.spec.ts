import { describe, expect, it } from 'vitest'
import { readChatStream } from '../src/stream.ts'

function bodyOf(...lines: readonly string[]): ReadableStream<BufferSource> {
  const encoder = new TextEncoder()
  return new ReadableStream<BufferSource>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n\n`))
      controller.close()
    },
  })
}

async function collect(body: ReadableStream<BufferSource>) {
  const chunks = []
  for await (const chunk of readChatStream(body, () => {})) chunks.push(chunk)
  return chunks
}

async function reject(body: ReadableStream<BufferSource>): Promise<unknown> {
  return collect(body).catch((error: unknown) => error)
}

describe('llm-local OpenAI SSE translation', () => {
  it('streams text and usage, then ends once after [DONE]', async () => {
    const body = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const chunks = []
    for await (const chunk of readChatStream(body, () => {})) chunks.push(chunk)
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hi' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('rejects malformed events, invalid tool arguments, missing finish reasons, and missing [DONE]', async () => {
    const malformed = new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {oops}\n\n')); controller.close() } })
    await expect(async () => { for await (const _chunk of readChatStream(malformed, () => {})) {} }).rejects.toThrow(/invalid JSON/u)

    const incomplete = new ReadableStream<BufferSource>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    } })
    await expect(collect(incomplete)).rejects.toThrow(/without a finish_reason/u)

    const truncated = new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')); controller.close() } })
    await expect(async () => { for await (const _chunk of readChatStream(truncated, () => {})) {} }).rejects.toThrow(/before \[DONE\]/u)

    const tool = new ReadableStream<BufferSource>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"id","function":{"name":"tool","arguments":"{"}}]},"finish_reason":"tool_calls"}]}\n\n'))
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    } })
    await expect(async () => { for await (const _chunk of readChatStream(tool, () => {})) {} }).rejects.toThrow(/not valid JSON/u)
  })

  it('maps in-band errors and content-filter finish reasons', async () => {
    const response = new ReadableStream<BufferSource>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"blocked"},"finish_reason":"content_filter"}]}\n\n'))
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    } })
    const chunks = []
    for await (const chunk of readChatStream(response, () => {})) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'CONTENT_REFUSED' } } })

    const failure = new ReadableStream<BufferSource>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"error":{"message":"insufficient_quota","code":"insufficient_quota"}}\n\n'))
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    } })
    const failed = []
    for await (const chunk of readChatStream(failure, () => {})) failed.push(chunk)
    expect(failed.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'QUOTA' } } })
  })

  it('merges repeated text deltas and reads optional usage details', async () => {
    const chunks = await collect(bodyOf(
      '{"usage":{"prompt_tokens":2,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":2},"completion_tokens_details":{"reasoning_tokens":1}}}',
      '{"choices":[{"delta":{"content":"a"}},{"delta":{"content":"b"},"finish_reason":"length"}]}',
      '[DONE]',
    ))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'a' },
      { type: 'text-delta', index: 0, text: 'b' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'ab' } },
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 2, reasoningTokens: 1 } },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ])
  })

  it('skips non-primary choices and frames after an in-band error', async () => {
    const chunks = await collect(bodyOf(
      '{"choices":[{"index":1,"delta":{"content":"other"}},{"delta":{"content":"kept"},"finish_reason":"stop"}]}',
      '[DONE]',
    ))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'kept' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'kept' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const deltaLess = await collect(bodyOf('{"choices":[{"finish_reason":"stop"}]}', '[DONE]'))
    expect(deltaLess.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } } })

    const failed = await collect(bodyOf(
      '{"error":{"message":"the endpoint is on fire"}}',
      '{"choices":[{"delta":{"content":"ignored"},"finish_reason":"stop"}]}',
      '[DONE]',
    ))
    expect(failed).toEqual([{
      type: 'finish', reason: { kind: 'error', failure: { message: 'llm-local: the endpoint is on fire', code: 'SERVER' } },
    }])

    const context = await collect(bodyOf(
      '{"error":{"message":"maximum context length exceeded"}}',
      '[DONE]',
    ))
    expect(context.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } })

    const anonymous = await collect(bodyOf('{"error":{}}', '[DONE]'))
    expect(anonymous.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { message: 'llm-local: the endpoint returned an in-band error', code: 'SERVER' } } })
  })

  it('rejects non-object events, choices, and unsupported finish reasons', async () => {
    expect(await reject(bodyOf('[1]', '[DONE]'))).toMatchObject({ code: 'MALFORMED_RESPONSE', message: expect.stringMatching(/must be a JSON object/u) as string })
    expect(await reject(bodyOf('{"choices":[1]}', '[DONE]'))).toMatchObject({ message: expect.stringMatching(/choice must be a JSON object/u) as string })
    expect(await reject(bodyOf('{}', '[DONE]'))).toMatchObject({ message: expect.stringMatching(/no choices array/u) as string })
    expect(await reject(bodyOf('{"usage":{"prompt_tokens":2}}', '[DONE]'))).toMatchObject({ message: expect.stringMatching(/no choices array/u) as string })
    expect(await reject(bodyOf('{"choices":[{"delta":{"content":"x"},"finish_reason":"weird"}]}', '[DONE]')))
      .toMatchObject({ message: expect.stringMatching(/unsupported finish_reason/u) as string })
  })

  it('rejects incomplete and changed tool calls and non-object tool arguments', async () => {
    expect(await reject(bodyOf(
      '{"choices":[{"delta":{"tool_calls":[{"id":"call-1"}]},"finish_reason":"tool_calls"}]}',
      '[DONE]',
    ))).toMatchObject({ message: expect.stringMatching(/no non-negative index/u) as string })

    expect(await reject(bodyOf(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"tool","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
      '[DONE]',
    ))).toMatchObject({ message: expect.stringMatching(/no id or function name/u) as string })

    expect(await reject(bodyOf(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"tool","arguments":"{"}}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"b","function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}]}',
      '[DONE]',
    ))).toMatchObject({ message: expect.stringMatching(/id changed/u) as string })

    expect(await reject(bodyOf(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"tool","arguments":"[1]"}}]},"finish_reason":"tool_calls"}]}',
      '[DONE]',
    ))).toMatchObject({ message: expect.stringMatching(/must be a JSON object/u) as string })
  })

  it('starts a tool call before its function name arrives', async () => {
    const chunks = await collect(bodyOf(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"arguments":"{\\"a\\":"}}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read"}}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}',
      '[DONE]',
    ))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call-1', argumentsDelta: '{"a":' },
      { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'read', argumentsDelta: '1}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"a":1}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })
})
