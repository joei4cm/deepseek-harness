/** Policy for URLs the Desktop shell may open outside the application. */

/** Names that reach the application's own Host through the loopback interface. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/**
 * Decide whether a URL addresses the application's own Host.
 * @param url - parsed candidate URL.
 * @param hostUrl - current Host URL, whose port the application owns.
 * @returns true when the URL reaches the application itself.
 */
export function isApplicationHost(url: URL, hostUrl: string | undefined): boolean {
  if (hostUrl === undefined || !URL.canParse(hostUrl)) return false
  const host = new URL(hostUrl)
  return url.port === host.port
    && (url.hostname === host.hostname || LOOPBACK_HOSTS.includes(url.hostname))
}

/**
 * Accept a URL that may open outside the application.
 * @param value - candidate URL from a page, a frame, or a native request.
 * @param hostUrl - current Host URL, whose port the application owns.
 * @returns the normalized URL, or undefined when the URL may not open externally.
 */
export function openableExternalUrl(value: string, hostUrl: string | undefined): string | undefined {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  if (isApplicationHost(url, hostUrl)) return undefined
  return url.href
}
