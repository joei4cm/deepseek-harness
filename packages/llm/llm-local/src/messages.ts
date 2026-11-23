/** OpenAI Chat Completions request projection from the harness message log. */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage, ToolSchema } from '@deepseek-ai/dsh-llm'

interface OpenAiToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

interface OpenAiMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | null
  readonly tool_call_id?: string
  readonly tool_calls?: readonly OpenAiToolCall[]
  readonly reasoning_content?: string
}

/** Read text and reasoning blocks without passing binary attachments to a text-only route. */
function textContent(message: RequestMessage): { text: string; reasoning: string } {
  const text: string[] = []
  const reasoning: string[] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text': text.push(block.text); break
      case 'reasoning': reasoning.push(block.text); break
      case 'tool-call':
      case 'tool-addition':
      case 'tool-removal':
        break
      case 'file':
      case 'image':
        throw new LlmError(`llm-local cannot send ${block.type} blocks to a text-only model`, 'UNSUPPORTED_CONTENT')
      default: break
    }
  }
  return { text: text.join(''), reasoning: reasoning.join('') }
}

/** Preserve historical assistant tool calls as raw OpenAI function arguments. */
function assistantToolCalls(message: RequestMessage): OpenAiToolCall[] {
  return message.content.flatMap((block) => {
    if (block.type !== 'tool-call') return []
    return [{
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: block.arguments },
    }]
  })
}

/** Convert one harness message to the local endpoint's supported chat roles. */
function toOpenAiMessage(message: RequestMessage): OpenAiMessage {
  const { text, reasoning } = textContent(message)
  switch (message.role) {
    case 'system':
    case 'developer':
      return { role: 'system', content: text }
    case 'user':
      return { role: 'user', content: text }
    case 'tool':
      return { role: 'tool', content: text, tool_call_id: message.toolCallId }
    case 'assistant': {
      const toolCalls = assistantToolCalls(message)
      return {
        role: 'assistant',
        content: text.length > 0 ? text : null,
        ...reasoning.length === 0 ? {} : { reasoning_content: reasoning },
        ...toolCalls.length === 0 ? {} : { tool_calls: toolCalls },
      }
    }
  }
}

/**
 * Build one streaming Chat Completions request.
 * @param options - fully assembled and route-projected harness request.
 * @returns JSON-ready request fields with OpenAI function tool declarations.
 */
export function serializeChatRequest(options: GenerateOptions): Record<string, unknown> {
  if (options.stop !== undefined && options.stop.length === 0) {
    throw new LlmError('llm-local stop sequences must not be empty', 'UNSUPPORTED_OPTION')
  }
  const messages: OpenAiMessage[] = []
  if (options.system !== undefined && options.system.length > 0) messages.push({ role: 'system', content: options.system })
  messages.push(...options.messages.map(toOpenAiMessage))
  const tools: { type: 'function'; function: ToolSchema }[] | undefined = options.tools?.map(tool => ({ type: 'function', function: tool }))
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...options.temperature === undefined ? {} : { temperature: options.temperature },
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop === undefined ? {} : { stop: options.stop },
    ...tools === undefined || tools.length === 0 ? {} : { tools },
  }
}
