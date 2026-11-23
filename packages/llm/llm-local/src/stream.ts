/** OpenAI-compatible Chat Completions SSE framing and chunk translation. */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import { brandString } from '@deepseek-ai/dsh-brand'
import { EMPTY_RESPONSE_CODE, LlmError, isContextWindowExceededError, isQuotaExceededError } from '@deepseek-ai/dsh-llm'
import type { FinishReason, StreamChunk, TokenUsage, ToolCallId } from '@deepseek-ai/dsh-llm'

interface ToolState {
  readonly blockIndex: number
  started: boolean
  id: string
  name: string
  arguments: string
  sentArguments: number
}

interface TranslationState {
  nextBlockIndex: number
  text?: { index: number; content: string; started: boolean }
  reasoning?: { index: number; content: string; started: boolean }
  tools: Map<number, ToolState>
  usage?: TokenUsage
  finishReason?: FinishReason
  failed: boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function malformed(message: string): LlmError {
  return new LlmError(`llm-local: ${message}`, 'MALFORMED_RESPONSE')
}

/** Read OpenAI usage when the endpoint supplies both primary counters. */
function readUsage(raw: unknown): TokenUsage | undefined {
  const usage = record(raw)
  if (usage === undefined) return undefined
  const inputTokens = nonNegativeInteger(usage.prompt_tokens)
  const outputTokens = nonNegativeInteger(usage.completion_tokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const promptDetails = record(usage.prompt_tokens_details)
  const completionDetails = record(usage.completion_tokens_details)
  const cacheReadTokens = nonNegativeInteger(promptDetails?.cached_tokens)
  const reasoningTokens = nonNegativeInteger(completionDetails?.reasoning_tokens)
  const totalTokens = nonNegativeInteger(usage.total_tokens)
  return {
    inputTokens,
    outputTokens,
    ...totalTokens === undefined ? {} : { totalTokens },
    ...cacheReadTokens === undefined || cacheReadTokens === 0 ? {} : { cacheReadTokens },
    ...reasoningTokens === undefined || reasoningTokens === 0 ? {} : { reasoningTokens },
  }
}

/** Map a Chat Completions terminal reason into the harness finish vocabulary. */
function finishReason(value: unknown): FinishReason | undefined {
  switch (value) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    case 'content_filter': return {
      kind: 'error',
      failure: { message: 'llm-local: the endpoint filtered the response', code: 'CONTENT_REFUSED' },
    }
    case null: return undefined
    default:
      if (value === undefined) return undefined
      throw malformed(`unsupported finish_reason ${JSON.stringify(value)}`)
  }
}

function ensureText(state: TranslationState): { index: number; content: string; started: boolean } {
  if (state.text === undefined) state.text = { index: state.nextBlockIndex++, content: '', started: false }
  return state.text
}

function ensureReasoning(state: TranslationState): { index: number; content: string; started: boolean } {
  if (state.reasoning === undefined) state.reasoning = { index: state.nextBlockIndex++, content: '', started: false }
  return state.reasoning
}

function toolState(state: TranslationState, sourceIndex: number): ToolState {
  let tool = state.tools.get(sourceIndex)
  if (tool === undefined) {
    tool = { blockIndex: state.nextBlockIndex++, started: false, id: '', name: '', arguments: '', sentArguments: 0 }
    state.tools.set(sourceIndex, tool)
  }
  return tool
}

/**
 * Translate one decoded SSE JSON payload into zero or more harness chunks.
 * @param state - response-local translation state.
 * @param raw - parsed provider event.
 * @returns chunks emitted by this event.
 */
export function translatePayload(state: TranslationState, raw: unknown): StreamChunk[] {
  const event = record(raw)
  if (event === undefined) throw malformed('stream event must be a JSON object')
  if (event.error !== undefined) {
    const error = record(event.error)
    const message = stringValue(error?.message) ?? 'the endpoint returned an in-band error'
    const detail = `${stringValue(error?.code) ?? ''} ${stringValue(error?.type) ?? ''} ${message}`
    const code = isQuotaExceededError(detail) ? 'QUOTA'
      : isContextWindowExceededError(detail) ? 'CONTEXT_WINDOW_EXCEEDED'
        : 'SERVER'
    state.finishReason = { kind: 'error', failure: { message: `llm-local: ${message}`, code } }
    state.failed = true
    return []
  }
  const chunks: StreamChunk[] = []
  const usage = readUsage(event.usage)
  if (usage !== undefined) state.usage = usage
  if (!Array.isArray(event.choices)) {
    if (usage !== undefined) return chunks
    throw malformed('stream event has no choices array')
  }
  for (const rawChoice of event.choices) {
    const choice = record(rawChoice)
    if (choice === undefined) throw malformed('choice must be a JSON object')
    if (choice.index !== undefined && choice.index !== 0) continue
    const delta = record(choice.delta)
    if (delta !== undefined) {
      const content = stringValue(delta.content)
      if (content !== undefined && content.length > 0) {
        const target = ensureText(state)
        if (!target.started) {
          target.started = true
          chunks.push({ type: 'block-start', index: target.index, blockType: 'text' })
        }
        target.content += content
        chunks.push({ type: 'text-delta', index: target.index, text: content })
      }
      const reasoning = stringValue(delta.reasoning_content)
      if (reasoning !== undefined && reasoning.length > 0) {
        const target = ensureReasoning(state)
        if (!target.started) {
          target.started = true
          chunks.push({ type: 'block-start', index: target.index, blockType: 'reasoning' })
        }
        target.content += reasoning
        chunks.push({ type: 'reasoning-delta', index: target.index, text: reasoning })
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const rawTool of delta.tool_calls) {
          const toolDelta = record(rawTool)
          const sourceIndex = nonNegativeInteger(toolDelta?.index)
          if (toolDelta === undefined || sourceIndex === undefined) throw malformed('tool-call delta has no non-negative index')
          const target = toolState(state, sourceIndex)
          if (!target.started) {
            target.started = true
            chunks.push({ type: 'block-start', index: target.blockIndex, blockType: 'tool-call' })
          }
          const id = stringValue(toolDelta.id)
          const fn = record(toolDelta.function)
          const name = stringValue(fn?.name)
          const args = stringValue(fn?.arguments)
          if (id !== undefined) {
            if (target.id.length > 0 && target.id !== id) throw malformed('tool-call id changed during the stream')
            target.id = id
          }
          if (name !== undefined) target.name += name
          if (args !== undefined) target.arguments += args
          if (target.id.length > 0 && target.arguments.length > target.sentArguments) {
            chunks.push({
              type: 'tool-call-delta',
              index: target.blockIndex,
              id: brandString<ToolCallId>(target.id),
              ...target.name.length === 0 ? {} : { name: target.name },
              argumentsDelta: target.arguments.slice(target.sentArguments),
            })
            target.sentArguments = target.arguments.length
          }
        }
      }
    }
    const reason = finishReason(choice.finish_reason)
    if (reason !== undefined) state.finishReason = reason
  }
  return chunks
}

function completeTool(tool: ToolState): Extract<StreamChunk, { type: 'block-end' }> {
  if (tool.id.length === 0 || tool.name.length === 0) throw malformed('completed tool call has no id or function name')
  let parsed: unknown
  try { parsed = JSON.parse(tool.arguments) } catch (error) {
    throw new LlmError(`llm-local: tool call "${tool.name}" arguments are not valid JSON`, 'MALFORMED_RESPONSE', { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw malformed(`tool call "${tool.name}" arguments must be a JSON object`)
  }
  return {
    type: 'block-end',
    index: tool.blockIndex,
    block: { type: 'tool-call', id: brandString<ToolCallId>(tool.id), name: tool.name, arguments: tool.arguments },
  }
}

/**
 * Parse one provider SSE body and emit ordered harness chunks.
 * @param body - the successful response stream.
 * @param activity - resets the caller's idle watchdog on events and comments.
 * @returns chunks through the terminal finish; missing `[DONE]` is a protocol failure.
 */
export async function* readChatStream(
  body: ReadableStream<BufferSource>,
  activity: () => void,
): AsyncGenerator<StreamChunk> {
  const events = body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream({ onComment: activity }))
  const state: TranslationState = { nextBlockIndex: 0, tools: new Map(), failed: false }
  let sawDone = false
  for await (const frame of events) {
    activity()
    if (frame.data === '[DONE]') {
      sawDone = true
      break
    }
    if (state.failed) continue
    let raw: unknown
    try { raw = JSON.parse(frame.data) } catch (error) {
      throw new LlmError('llm-local: SSE event contains invalid JSON', 'MALFORMED_RESPONSE', { cause: error })
    }
    for (const chunk of translatePayload(state, raw)) yield chunk
  }
  if (!sawDone) throw new LlmError('llm-local: SSE stream ended before [DONE]', 'STREAM_CLOSED')
  const endings: Extract<StreamChunk, { type: 'block-end' }>[] = []
  if (state.text !== undefined) {
    endings.push({ type: 'block-end', index: state.text.index, block: { type: 'text', text: state.text.content } })
  }
  if (state.reasoning !== undefined) {
    endings.push({ type: 'block-end', index: state.reasoning.index, block: { type: 'reasoning', text: state.reasoning.content } })
  }
  for (const tool of state.tools.values()) endings.push(completeTool(tool))
  endings.sort((left, right) => left.index - right.index)
  for (const chunk of endings) yield chunk
  if (state.usage !== undefined) yield { type: 'usage', usage: state.usage }
  const reason = state.finishReason
  if (reason === undefined) {
    if (state.text === undefined && state.reasoning === undefined && state.tools.size === 0) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'llm-local: completed response contained no content', code: EMPTY_RESPONSE_CODE } } }
      return
    }
    throw new LlmError('llm-local: SSE stream ended without a finish_reason', 'MALFORMED_RESPONSE')
  }
  if (reason.kind === 'stop' && state.text === undefined && state.reasoning === undefined && state.tools.size === 0) {
    yield {
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'llm-local: completed response contained no content', code: EMPTY_RESPONSE_CODE } },
    }
    return
  }
  yield { type: 'finish', reason }
}
