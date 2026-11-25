/** URLs the Desktop shell opens outside the application follow one shared policy. */
import { describe, expect, it } from 'vitest'
import { isApplicationHost, openableExternalUrl } from '../src/external-navigation.ts'

const host = 'http://127.0.0.1:3080/'

describe('external navigation policy', () => {
  it('accepts an absolute HTTP(S) URL outside the application', () => {
    expect(openableExternalUrl('https://example.com/page', host)).toBe('https://example.com/page')
    expect(openableExternalUrl('http://example.com', host)).toBe('http://example.com/')
  })

  it('refuses a URL that may not open outside the application', () => {
    expect(openableExternalUrl('not a url', host)).toBeUndefined()
    expect(openableExternalUrl('ftp://example.com/file', host)).toBeUndefined()
    expect(openableExternalUrl('file:///etc/passwd', host)).toBeUndefined()
    expect(openableExternalUrl('javascript:alert(1)', host)).toBeUndefined()
    expect(openableExternalUrl('https://user@example.com/', host)).toBeUndefined()
    expect(openableExternalUrl('https://user:hunter2@example.com/', host)).toBeUndefined()
  })

  it('refuses the application own Host, including its loopback names', () => {
    expect(openableExternalUrl('http://127.0.0.1:3080/', host)).toBeUndefined()
    expect(openableExternalUrl('http://localhost:3080/', host)).toBeUndefined()
    expect(openableExternalUrl('http://[::1]:3080/', host)).toBeUndefined()
    expect(openableExternalUrl('http://127.0.0.1:3081/', host)).toBe('http://127.0.0.1:3081/')
    expect(openableExternalUrl('http://127.0.0.1:3080/', undefined)).toBe('http://127.0.0.1:3080/')
  })

  it('recognizes the application Host only while its URL is known', () => {
    const url = new URL('http://127.0.0.1:3080/')
    expect(isApplicationHost(url, host)).toBe(true)
    expect(isApplicationHost(url, undefined)).toBe(false)
    expect(isApplicationHost(url, 'not a url')).toBe(false)
    expect(isApplicationHost(new URL('https://example.com/'), host)).toBe(false)
  })
})
