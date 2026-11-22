import { describe, expect, it } from 'vitest'
import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { canonicalHeader } from '@deepseek-ai/dsh-session'
import {
  estimateContent,
  estimateMessage,
  estimateSystemMessage,
  estimateTextTokens,
  estimateToolsTokens,
} from '../src/estimate.ts'

/**
 * A Chinese paragraph and the token count the DeepSeek-V3 tokenizer gives it.
 * The count comes from that tokenizer's published `tokenizer.json`, so the
 * heuristic is measured against a provider rather than against itself.
 */
const CJK_PARAGRAPH = '上下文指示器严重低估：界面显示百分之二十四，实际请求却有一百二十万个 token，超过了模型窗口，服务端返回四百错误，自动压缩因此也无法发出，整轮对话彻底卡死。修复的方向是让估算器对中文按字符计费。'
const CJK_PARAGRAPH_PROVIDER_TOKENS = 56

/**
 * The first code point of every range the estimator prices as CJK: Hangul
 * jamo, CJK radicals, kana, Bopomofo, Hangul compatibility jamo, CJK strokes,
 * Han extension A, Han, Hangul jamo extended-A, Hangul syllables, and Han
 * compatibility ideographs.
 */
const CJK_RANGE_STARTS = [
  0x1100, 0x2e80, 0x3040, 0x3100, 0x3130, 0x31f0,
  0x3400, 0x4e00, 0xa960, 0xac00, 0xf900,
]

/** The first code point of every range the estimator prices as fullwidth. */
const FULLWIDTH_RANGE_STARTS = [0x3000, 0xfe10, 0xfe30, 0xff01, 0xffe0]

describe('Token density by script', () => {
  it('prices ASCII text at four characters per token', () => {
    expect(estimateContent([{ type: 'text', text: 'abcd' }])).toBe(5)
    expect(estimateContent([{ type: 'text', text: 'abcdefgh' }])).toBe(6)
  })

  it('prices a Chinese paragraph near the DeepSeek-V3 tokenizer', () => {
    const estimate = estimateTextTokens(CJK_PARAGRAPH)
    const error = Math.abs(estimate - CJK_PARAGRAPH_PROVIDER_TOKENS) / CJK_PARAGRAPH_PROVIDER_TOKENS
    expect(error).toBeLessThanOrEqual(0.2)
  })

  it('prices CJK punctuation at about one token per character', () => {
    expect(estimateContent([{ type: 'text', text: '。'.repeat(10) }])).toBe(14)
  })

  it('prices every CJK script as a CJK character', () => {
    const han = estimateTextTokens('一'.repeat(10))
    for (const start of CJK_RANGE_STARTS) {
      expect(estimateTextTokens(String.fromCodePoint(start).repeat(10))).toBe(han)
    }
    expect(han).toBeGreaterThan(estimateTextTokens('a'.repeat(10)))
    expect(han).toBeLessThan(estimateTextTokens('。'.repeat(10)))
  })

  it('prices every fullwidth range as a fullwidth character', () => {
    const punctuation = estimateTextTokens('。'.repeat(10))
    for (const start of FULLWIDTH_RANGE_STARTS) {
      expect(estimateTextTokens(String.fromCodePoint(start).repeat(10))).toBe(punctuation)
    }
    expect(punctuation).toBeGreaterThan(estimateTextTokens('一'.repeat(10)))
  })

  it('prices other non-ASCII scripts above ASCII and below CJK', () => {
    const ascii = estimateContent([{ type: 'text', text: 'a'.repeat(50) }])
    const cyrillic = estimateContent([{ type: 'text', text: 'о'.repeat(50) }])
    const cjk = estimateContent([{ type: 'text', text: '中'.repeat(50) }])
    expect(ascii).toBe(17)
    expect(cyrillic).toBeGreaterThan(ascii)
    expect(cjk).toBeGreaterThan(cyrillic)
  })

  it('prices a mixed message as the sum of its classes', () => {
    const text = '中文 mixed with English, and 123 numbers.'
    const estimate = estimateContent([{ type: 'text', text }])
    const asciiOnly = estimateContent([{ type: 'text', text: 'x'.repeat(text.length) }])
    expect(estimate).toBeGreaterThan(asciiOnly)
  })

  it('prices the system prompt by the same density', () => {
    expect(estimateSystemMessage(createSystemMessage('中文'))).toBe(6)
    expect(estimateSystemMessage(createSystemMessage('abcd'))).toBe(5)
    expect(estimateSystemMessage(createSystemMessage(''))).toBe(0)
  })

  it('prices tool schemas by the same density', () => {
    const header = canonicalHeader({
      config: { provider: 'mock', model: 'mock' },
      tools: [{ name: 'bash', description: '执行命令', parameters: { type: 'object' } }],
    })
    expect(estimateToolsTokens(header)).toBeGreaterThan(0)
    expect(estimateToolsTokens(undefined)).toBe(0)
    expect(estimateToolsTokens(canonicalHeader({ config: { provider: 'mock', model: 'mock' }, tools: [] }))).toBe(0)
  })

  it('leaves an ASCII message at its documented price', () => {
    const text = 'The context indicator under-reports the next request size.'
    expect(estimateMessage(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })))
      .toBe(Math.ceil(text.length / 4) + 8)
  })

  it('prices an unknown block as its structural JSON', () => {
    const unknown = { type: 'merge-extended', payload: '中文' } as unknown as ContentBlock
    expect(estimateContent([unknown])).toBeGreaterThan(4)
  })
})
