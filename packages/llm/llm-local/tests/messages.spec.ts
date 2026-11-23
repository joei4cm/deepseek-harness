import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AttachmentId, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { serializeChatRequest } from '../src/messages.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface ContentBlockMap {
    'llm-local-test': { type: 'llm-local-test'; text: string }
  }
}

describe('llm-local message projection', () => {
  it('maps request-only system text, tool results, and assistant reasoning to chat messages', () => {
    const body = serializeChatRequest({
      provider: 'local', model: 'model', system: 'one-shot instructions',
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } }),
        createAssistantMessage({
          content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text: 'answer' }],
          source: { provider: 'local', model: 'model' },
        }),
        createToolResultMessage({ callId: brandString<ToolCallId>('call'), content: [{ type: 'text', text: 'result' }], isError: false }),
      ],
    })
    expect(body.messages).toEqual([
      { role: 'system', content: 'one-shot instructions' },
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer', reasoning_content: 'private' },
      { role: 'tool', content: 'result', tool_call_id: 'call' },
    ])
  })

  it('omits reasoning_content for plain assistant turns and drops unknown plugin blocks', () => {
    const body = serializeChatRequest({
      provider: 'local', model: 'model',
      messages: [
        createUserMessage({ content: [{ type: 'llm-local-test', text: 'vendor-only' }, { type: 'text', text: 'question' }], source: { kind: 'user' } }),
        createAssistantMessage({ content: [{ type: 'text', text: 'answer' }], source: { provider: 'local', model: 'model' } }),
      ],
    })
    expect(body.messages).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ])
  })

  it('rejects binary blocks that reach a local text-only endpoint', () => {
    const image: ImageAttachmentRef = {
      attachmentId: brandString<AttachmentId>('image-1'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    }
    const file: FileAttachmentRef = {
      attachmentId: brandString<AttachmentId>('file-1'), name: 'notes.txt', bytes: 3,
    }
    expect(() => serializeChatRequest({
      provider: 'local', model: 'model',
      messages: [createUserMessage({ content: [{ type: 'image', attachment: image }], source: { kind: 'user' } })],
    })).toThrow(/text-only/u)
    expect(() => serializeChatRequest({
      provider: 'local', model: 'model',
      messages: [createUserMessage({ content: [{ type: 'file', attachment: file }], source: { kind: 'user' } })],
    })).toThrow(/text-only/u)
  })

  it('rejects empty stop sequences that no endpoint can honor', () => {
    expect(() => serializeChatRequest({ provider: 'local', model: 'model', messages: [], stop: [] }))
      .toThrow(/stop sequences/u)
  })
})
