/**
 * URL validation, content-type classification, and charset resolution for the
 * local HTTP(S) fetch provider — the pure, network-free half. The provider's
 * `fetch()` composes these with transport (redirect following, byte caps,
 * decoding).
 *
 * @module @deepseek-ai/dsh-web-fetch-http/policy
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** Maximum accepted request URL length enforced by the fetch provider. */
export const WEB_FETCH_MAX_URL_LENGTH = 2048

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Parse a request URL and enforce network-independent transport restrictions:
 * HTTP(S) only and no embedded credentials. The provider applies this before
 * resolving a destination.
 *
 * @param input - the raw URL string from the fetch request.
 * @returns the parsed `URL`.
 */
export function parseFetchUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Validate a request URL against the provider's complete pre-network policy:
 * bounded length plus the restrictions enforced by {@link parseFetchUrl}.
 * Public-address resolution and connection pinning run after this check.
 *
 * @param input - the raw URL string from the fetch request.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string): URL {
  if (input.length > WEB_FETCH_MAX_URL_LENGTH) {
    throw new WebError(`URL exceeds the maximum length of ${WEB_FETCH_MAX_URL_LENGTH}`, 'WEB_INVALID_URL')
  }
  return parseFetchUrl(input)
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call.
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * The lower-cased media type of a `Content-Type` header, without parameters or
 * a comma-joined duplicate header's later values.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the parsed media type, or an empty string when none is declared.
 */
function parseMediaType(contentType: string | null): string {
  return (contentType ?? '')
    .replace(/,[\s\S]*$/, '')
    .replace(/;[\s\S]*$/, '')
    .trim()
    .toLowerCase()
}

/**
 * Whether the media type names a document whose saved bytes a deployment's
 * document tools can render, so the rejection can point at a local save.
 *
 * @param mime - the parsed media type.
 * @returns true for PDF, Office, and opaque binary document types.
 */
function isDocumentMediaType(mime: string): boolean {
  return mime === 'application/pdf'
    || mime === 'application/msword'
    || mime === 'application/octet-stream'
    || mime.startsWith('application/vnd.ms-')
    || mime.startsWith('application/vnd.openxmlformats-officedocument.')
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*`, script text types, and a few structured text
 * types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = parseMediaType(contentType)
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/javascript' || mime === 'application/ecmascript') return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Build the rejection message for an unsupported response body. The message
 * names the parsed media type instead of the raw header, so parameters and
 * duplicated headers cannot reach model-visible text, and names the
 * alternative that can still read the content: a document-like body is worth
 * saving locally for the document tools, while other binaries are worth
 * re-fetching as text or HTML.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the model-visible rejection message.
 */
export function unsupportedContentTypeMessage(contentType: string | null): string {
  const mime = parseMediaType(contentType)
  const alternative = isDocumentMediaType(mime)
    ? 'save the response body to a file (for example with a shell download) and open it with the document tools'
    : 'fetch a text or HTML version of this resource instead'
  return `unsupported content type "${mime === '' ? 'unknown' : mime}": only text-like bodies decode; ${alternative}`
}

/**
 * Extract the lower-cased `charset` parameter from a response `Content-Type`.
 *
 * @param contentType - the raw header, or `null` when absent.
 * @returns the charset parameter, or `undefined` when none is declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Resolve the declared charset, defaulting to UTF-8 when absent. A malformed
 * comma- or whitespace-joined declaration containing a UTF-8 label uses a fatal
 * UTF-8 decoder; other unsupported declarations throw `WEB_UNSUPPORTED_CONTENT_TYPE`.
 * UTF-8 recovery is a preference, not proof of the original encoding.
 *
 * @param charset - the declared charset parameter, or `undefined` to default.
 * @returns a decoder; callers must report fatal decoding failures and flush at
 *   EOF unless they deliberately truncated the bytes.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  const declared = charset ?? 'utf-8'
  try {
    return new TextDecoder(declared)
  } catch (error: unknown) {
    if (declared.split(/[\s,]+/).some(isUtf8Label)) return new TextDecoder('utf-8', { fatal: true })
    throw new WebError(`unsupported charset "${declared}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}

/** Whether a label names UTF-8, including its standard aliases. */
function isUtf8Label(label: string): boolean {
  try {
    return new TextDecoder(label).encoding === 'utf-8'
  } catch (_error: unknown) {
    // An unsupported label does not authorize UTF-8 recovery.
    return false
  }
}
