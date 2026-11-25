/** External link requests from the interactive HTML preview: URL policy, request shape, and request limits. */

/** Message type the interactive preview frame posts for an external link. */
export const EXTERNAL_LINK_MESSAGE = 'dsh:html-external-link'

/** Longest URL a preview may ask the application to open. */
const MAX_EXTERNAL_URL_LENGTH = 2048

/**
 * Accept an absolute HTTP(S) URL that carries no embedded credentials.
 * @param value - candidate URL.
 * @returns the normalized URL, or undefined when it may not open outside the application.
 */
export function externalLinkUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH) return undefined
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  return url.href
}

/**
 * Read an external link request posted by a preview frame.
 * @param data - message payload received from a frame.
 * @returns the URL to open, or undefined when the payload is not an external link request.
 */
export function externalLinkRequest(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  if (!('type' in data) || !('url' in data)) return undefined
  if (data.type !== EXTERNAL_LINK_MESSAGE) return undefined
  return externalLinkUrl(data.url)
}

/** Bounds on how many external links one preview may request. */
export interface ExternalLinkLimits {
  /** Requests accepted inside one window. */
  readonly limit: number
  /** Length of the window in milliseconds. */
  readonly windowMs: number
  /** Silence after one URL, so the same link opens once. */
  readonly dedupeMs: number
}

/** Bounds that keep a hostile preview from opening links without limit. */
export const EXTERNAL_LINK_LIMITS: ExternalLinkLimits = Object.freeze({
  limit: 5,
  windowMs: 5_000,
  dedupeMs: 1_000,
})

/** Acceptance of external link requests for one preview. */
export interface ExternalLinkGate {
  /**
   * Decide whether a request may open now.
   * @param url - validated external URL.
   * @returns true when the request is within the limits and not a recent repeat.
   */
  accept(url: string): boolean
}

/**
 * Create the bounded acceptance gate of one preview.
 * @param limits - request bounds.
 * @param now - clock reading in milliseconds.
 * @returns the gate, which accepts a request at most once per bound.
 */
export function createExternalLinkGate(
  limits: ExternalLinkLimits = EXTERNAL_LINK_LIMITS,
  now: () => number = Date.now,
): ExternalLinkGate {
  const accepted: { url: string; at: number }[] = []
  return {
    accept(url: string): boolean {
      const time = now()
      const recent = accepted.filter(entry => time - entry.at < limits.windowMs)
      const previous = recent.find(entry => entry.url === url)
      if (previous !== undefined && time - previous.at < limits.dedupeMs) return false
      if (recent.length >= limits.limit) return false
      accepted.splice(0, accepted.length, ...recent, { url, at: time })
      return true
    },
  }
}
