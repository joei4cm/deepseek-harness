/** Prepare plugin-contributed request fields and commit their delivery after HTTP acceptance. */

import { errorChain, LlmError } from '@deepseek-ai/dsh-llm'
import { toWellFormedValue } from '@deepseek-ai/dsh-util-values'
import type { DeepSeekLlmApiExtensionRequest, PreparedDeepSeekLlmApiExtensions } from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import type { DeepSeekAdapterOptions } from './types.ts'

/**
 * Merge contributions without replacing Messages fields. A rejected preparation or
 * a base-field collision reports REQUEST_EXTENSION with the cause chain appended to
 * the message. When the merged request fails to serialize, the payload is the
 * base request alone and acceptance is a no-op, so contributors resend their
 * unaccepted state on a later request. An acceptance failure is reported and
 * does not fail the request.
 *
 * The payload carries only well-formed text: a lone UTF-16 surrogate in any
 * string is replaced with U+FFFD, because the Messages API rejects a request
 * body whose JSON carries an unpaired surrogate escape.
 * @param body - serialized Messages request before extension fields.
 * @param options - request identity, purpose, and cancellation.
 * @param prepare - contributor registry captured for this adapter.
 * @param onOmitted - receives the omitted field names and the serialization failure.
 * @param onUnaccepted - receives an acceptance failure after HTTP 2xx.
 * @returns HTTP payload and a commit to invoke only after a successful HTTP response.
 */
export async function prepareRequestExtensions(
  body: DeepSeekLlmApiExtensionRequest['body'],
  options: Omit<DeepSeekLlmApiExtensionRequest, 'body'>,
  prepare: DeepSeekAdapterOptions['prepareExtensions'],
  onOmitted: (fields: readonly string[], error: unknown) => void,
  onUnaccepted: (error: unknown) => void,
): Promise<{ payload: string; accept(): Promise<void> }> {
  let extensions: PreparedDeepSeekLlmApiExtensions
  try {
    extensions = await prepare({ body, ...options })
  } catch (error) {
    throw new LlmError(`DeepSeek request extension preparation failed: ${errorChain(error)}`, 'REQUEST_EXTENSION', { cause: error })
  }
  const fields = Object.keys(extensions.fields)
  for (const field of fields) {
    if (Object.hasOwn(body, field)) {
      throw new LlmError(`DeepSeek request extension field ${JSON.stringify(field)} collides with the base request`, 'REQUEST_EXTENSION')
    }
  }
  let payload: string
  try {
    payload = JSON.stringify(toWellFormedValue({ ...body, ...extensions.fields }))
  } catch (error) {
    // A base request that cannot serialize throws here, before any field is reported as omitted.
    const base = JSON.stringify(toWellFormedValue(body))
    onOmitted(fields, error)
    return { payload: base, accept: () => Promise.resolve() }
  }
  return {
    payload,
    async accept() {
      try {
        await extensions.accept()
      } catch (error) {
        onUnaccepted(error)
      }
    },
  }
}
