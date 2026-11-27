/** Native source admission preserves unknown attribution and refuses retired plugin wrappers. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent } from '@deepseek-ai/dsh-session-format'
import { mapEventMessages } from './sources.ts'

/** Character bound for the observed-source excerpt; JSON.stringify output is ASCII, so slicing cannot split a code point. */
const SOURCE_EXCERPT_CHARS = 200

function describeSource(message: Readonly<Record<string, unknown>>): string {
  const value = message['source']
  return isSessionFormatJsonObject(value) ? JSON.stringify(value).slice(0, SOURCE_EXCERPT_CHARS) : 'missing'
}

function source(message: Readonly<Record<string, unknown>>, label: string): void {
  const value = message['source']
  if (!isSessionFormatJsonObject(value) || typeof value['kind'] !== 'string' || value['kind'].length === 0 || value['kind'] === 'plugin') {
    throw new SessionFormatError(`format v4 message requires a producer-owned source kind (${label}: ${describeSource(message)})`)
  }
}

/**
 * Validate producer attribution in every declared durable message slot.
 * @param event - complete native V4 event before Session adoption.
 */
export function assertV4MessageSources(event: SessionFormatEvent): void {
  mapEventMessages(event, (message) => {
    source(message, event.type)
    return message
  })
}

/**
 * Refuse retired source syntax even after a malformed recoverable row; leave incomplete messages to decoding.
 * @param row - parsed row whose incomplete values have not been classified by the scanner.
 */
export function assertV4SourceRowAdmission(row: unknown): void {
  if (!isSessionFormatJsonObject(row) || !isSessionFormatJsonObject(row['data'])) return
  const data = row['data']
  const messages = row['type'] === 'user/message' ? [data]
    : row['type'] === 'system/message' || row['type'] === 'assistant/message' || row['type'] === 'tool/result' ? [data['message']]
      : row['type'] === 'agent/inbox/spliced' ? data['inserted']
        : row['type'] === 'session/title-llm-request' ? data['messages'] : []
  if (!Array.isArray(messages)) return
  for (const message of messages) {
    if (!isSessionFormatJsonObject(message)) continue
    const value = message['source']
    if (isSessionFormatJsonObject(value) && value['kind'] === 'plugin') source(message, String(row['type']))
  }
}
