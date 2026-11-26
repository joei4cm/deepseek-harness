/** Lone UTF-16 surrogates are replaced before text reaches a JSON boundary. */
import { describe, expect, it } from 'vitest'
import { toWellFormedText, toWellFormedValue } from '../src/index.ts'

/** A lone high surrogate, as model-written code produces by slicing a pair. */
const LONE_HIGH = '\uD83D'
/** A lone low surrogate. */
const LONE_LOW = '\uDE32'
/** A complete astral character, as two well-formed surrogate code units. */
const PAIR = '😲'

describe('well-formed text', () => {
  it('replaces a lone surrogate with U+FFFD and keeps a complete pair', () => {
    expect(toWellFormedText(`a${LONE_HIGH}b`)).toBe('a�b')
    expect(toWellFormedText(`a${LONE_LOW}b`)).toBe('a�b')
    expect(toWellFormedText(PAIR)).toBe(PAIR)
    expect(toWellFormedText('plain text')).toBe('plain text')
  })

  it('returns the same string when it is already well formed', () => {
    const text = `plain ${PAIR}`
    expect(toWellFormedText(text)).toBe(text)
  })

  it('replaces lone surrogates in nested strings and leaves the input untouched', () => {
    const value = { a: LONE_HIGH, b: [1, { c: LONE_LOW }], d: PAIR, e: null }
    const result = toWellFormedValue(value)
    expect(result).toEqual({ a: '�', b: [1, { c: '�' }], d: PAIR, e: null })
    expect(result).not.toBe(value)
    expect(value.a).toBe(LONE_HIGH)
  })

  it('returns a value without a lone surrogate unchanged', () => {
    const value = { a: 'x', b: [1, 2] }
    expect(toWellFormedValue(value)).toBe(value)
  })

  it('carries an object that is not a record or array over as it stands', () => {
    const buffer = Buffer.from('payload')
    const result = toWellFormedValue({ buffer })
    expect(result.buffer).toBe(buffer)
  })
})
