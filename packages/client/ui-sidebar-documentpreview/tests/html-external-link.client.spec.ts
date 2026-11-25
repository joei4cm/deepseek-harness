// @vitest-environment jsdom
/** External link requests from the preview frame pass one URL policy and one bounded gate. */
import { describe, expect, it } from 'vitest'
import {
  createExternalLinkGate,
  externalLinkRequest,
  externalLinkUrl,
  EXTERNAL_LINK_MESSAGE,
} from '../src/client/html/external-link.ts'

describe('external link policy', () => {
  it('accepts absolute HTTP(S) URLs and normalizes them', () => {
    expect(externalLinkUrl('https://example.com/page')).toBe('https://example.com/page')
    expect(externalLinkUrl('http://example.com')).toBe('http://example.com/')
    expect(externalLinkUrl(' https://example.com/a ')).toBe('https://example.com/a')
  })

  it('rejects every URL that may not open outside the application', () => {
    expect(externalLinkUrl(undefined)).toBeUndefined()
    expect(externalLinkUrl(42)).toBeUndefined()
    expect(externalLinkUrl('')).toBeUndefined()
    expect(externalLinkUrl('not a url')).toBeUndefined()
    expect(externalLinkUrl('/relative/path')).toBeUndefined()
    expect(externalLinkUrl('javascript:alert(1)')).toBeUndefined()
    expect(externalLinkUrl('data:text/html,<p>x')).toBeUndefined()
    expect(externalLinkUrl('blob:https://example.com/id')).toBeUndefined()
    expect(externalLinkUrl('mailto:someone@example.com')).toBeUndefined()
    expect(externalLinkUrl('file:///etc/passwd')).toBeUndefined()
    expect(externalLinkUrl('https://user@example.com/')).toBeUndefined()
    expect(externalLinkUrl('https://user:p%40ss@example.com/')).toBeUndefined()
    expect(externalLinkUrl(`https://example.com/${'x'.repeat(3000)}`)).toBeUndefined()
  })

  it('reads only the documented request shape', () => {
    expect(externalLinkRequest({ type: EXTERNAL_LINK_MESSAGE, url: 'https://example.com/a' }))
      .toBe('https://example.com/a')
    expect(externalLinkRequest({ type: 'other', url: 'https://example.com/a' })).toBeUndefined()
    expect(externalLinkRequest({ type: EXTERNAL_LINK_MESSAGE })).toBeUndefined()
    expect(externalLinkRequest({ url: 'https://example.com/a' })).toBeUndefined()
    expect(externalLinkRequest({ type: EXTERNAL_LINK_MESSAGE, url: 'javascript:alert(1)' })).toBeUndefined()
    expect(externalLinkRequest('https://example.com/a')).toBeUndefined()
    expect(externalLinkRequest(undefined)).toBeUndefined()
    expect(externalLinkRequest(null)).toBeUndefined()
  })
})

describe('external link gate', () => {
  it('accepts distinct links within the window and refuses the request past the limit', () => {
    let time = 0
    const gate = createExternalLinkGate({ limit: 2, windowMs: 5_000, dedupeMs: 1_000 }, () => time)
    expect(gate.accept('https://example.com/a')).toBe(true)
    expect(gate.accept('https://example.com/b')).toBe(true)
    expect(gate.accept('https://example.com/c')).toBe(false)
    time = 5_000
    expect(gate.accept('https://example.com/c')).toBe(true)
  })

  it('refuses a repeated link within the silence and accepts it afterwards', () => {
    let time = 0
    const gate = createExternalLinkGate({ limit: 5, windowMs: 5_000, dedupeMs: 1_000 }, () => time)
    expect(gate.accept('https://example.com/a')).toBe(true)
    time = 999
    expect(gate.accept('https://example.com/a')).toBe(false)
    time = 1_000
    expect(gate.accept('https://example.com/a')).toBe(true)
  })
})
