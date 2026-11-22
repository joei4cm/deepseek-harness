/**
 * Script-aware token pricing shared by the meter service and the pure
 * context-breakdown projection, so both surfaces price identical content
 * to identical numbers.
 *
 * @module @deepseek-ai/dsh-token-meter/estimate
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { EpochHeader } from '@deepseek-ai/dsh-session'

/**
 * Tokens per ASCII character. ASCII prose merges at about five characters per
 * token, ASCII source at about four, and JSON at about three, so four is the
 * shared middle.
 */
const ASCII_TOKENS_PER_CHAR = 0.25

/**
 * Tokens per CJK ideograph, kana, or Hangul syllable. CJK text merges into
 * longer words than ASCII does and costs about two characters per token.
 */
const CJK_TOKENS_PER_CHAR = 0.65

/**
 * Tokens per CJK punctuation mark or fullwidth form. Each costs about three
 * quarters of a token.
 */
const FULLWIDTH_TOKENS_PER_CHAR = 1

/**
 * Tokens per other non-ASCII character. Cyrillic runs merge at about three
 * characters per token and accented Latin at about three, while rarer scripts
 * cost more; four tenths covers the common cases.
 */
const OTHER_TOKENS_PER_CHAR = 0.4

/** Per-block structural overhead for JSON framing and type tags. */
const BLOCK_OVERHEAD = 4

/** Blank-line separator between system prompt blocks, priced as two ASCII characters. */
const BLANK_LINE_TOKENS = 2 * ASCII_TOKENS_PER_CHAR

/** Role-field framing overhead added to every priced message. */
export const ROLE_OVERHEAD = 4

/**
 * Report whether a code unit belongs to a CJK punctuation mark or a fullwidth
 * form, each of which costs about three quarters of a token.
 * @param code - UTF-16 code unit to classify.
 * @returns true for fullwidth punctuation and forms.
 */
function isFullwidth(code: number): boolean {
  return (code >= 0x3000 && code <= 0x303f)
    || (code >= 0xfe10 && code <= 0xfe1f)
    || (code >= 0xfe30 && code <= 0xfe4f)
    || (code >= 0xff01 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
}

/**
 * Report whether a code unit belongs to a CJK ideograph, kana, or Hangul
 * syllable, the scripts that merge into longer words.
 * @param code - UTF-16 code unit to classify.
 * @returns true for CJK ideographs, kana, and Hangul.
 */
function isCjk(code: number): boolean {
  return (code >= 0x1100 && code <= 0x11ff)
    || (code >= 0x2e80 && code <= 0x2eff)
    || (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x3100 && code <= 0x312f)
    || (code >= 0x3130 && code <= 0x318f)
    || (code >= 0x31f0 && code <= 0x31ff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xa960 && code <= 0xa97f)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0xf900 && code <= 0xfaff)
}

/**
 * Price text by the density of the script it is written in, before rounding.
 * @param text - text to price without mutation.
 * @returns token weight; ASCII text weighs a quarter token per character.
 */
function textWeight(text: string): number {
  let weight = 0
  let index = 0
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code < 0x80) {
      const start = index
      while (index < text.length && text.charCodeAt(index) < 0x80) index++
      weight += (index - start) * ASCII_TOKENS_PER_CHAR
      continue
    }
    weight += isFullwidth(code)
      ? FULLWIDTH_TOKENS_PER_CHAR
      : isCjk(code) ? CJK_TOKENS_PER_CHAR : OTHER_TOKENS_PER_CHAR
    index++
  }
  return weight
}

/**
 * Price text by the density of the script it is written in.
 * @param text - text to price without mutation.
 * @returns tokens for the text under the script-aware density.
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(textWeight(text))
}

/**
 * Structural JSON price of one block outside the typed pricing arms: the
 * script-aware density for merge-extended blocks and for image references,
 * whose request price is route-owned rather than fixed. Image offload marks do
 * not change this reference-only heuristic; route pricing owns their placeholders.
 * @param block - block to price without mutation.
 * @returns heuristic tokens for the block's JSON structure.
 */
export function estimateStructuralBlock(block: ContentBlock): number {
  if (block.type === 'image') {
    const { offloaded: _offloaded, ...reference } = block
    return BLOCK_OVERHEAD + estimateTextTokens(JSON.stringify(reference))
  }
  return BLOCK_OVERHEAD + estimateTextTokens(JSON.stringify(block))
}

/**
 * Price content blocks recursively under the script-aware density.
 * @param blocks - content blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += estimateTextTokens(block.text) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += estimateTextTokens(block.name)
          + estimateTextTokens(block.arguments)
          + BLOCK_OVERHEAD
        break
      default:
        // ContentBlockMap is merge-extensible; unknown blocks (and image
        // references, whose request price is route-owned) retain a
        // conservative structural JSON price under the same density.
        tokens += estimateStructuralBlock(block)
    }
  }
  return tokens
}

/**
 * Price the rendered system prompt: the `system/message` surface node's text.
 * Adapters serialize the prompt as a plain string — a system-role message or
 * the request's system field — not as a typed content block, so the price is
 * text density plus blank-line separators and role framing with no per-block overhead.
 * @param message - system-role message to price without mutation.
 * @returns heuristic system-prompt tokens; 0 for empty content ("no system prompt").
 */
export function estimateSystemMessage(message: Message): number {
  let weight = 0
  let blocks = 0
  for (const block of message.content) {
    const text = block.type === 'text' ? block.text.trim() : JSON.stringify(block)
    if (text.length === 0) continue
    if (blocks > 0) weight += BLANK_LINE_TOKENS
    weight += textWeight(text)
    blocks++
  }
  return blocks === 0 ? 0 : Math.ceil(weight) + ROLE_OVERHEAD
}

/**
 * Heuristically price one model-visible message.
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the script-aware density; a
 *   system-role message prices as {@link estimateSystemMessage}.
 */
export function estimateMessage(message: Message): number {
  if (message.role === 'system') return estimateSystemMessage(message)
  return estimateContent(message.content) + ROLE_OVERHEAD
}

/**
 * Price the tool-schema part of a canonical request envelope — the envelope's
 * only priced field, since the system prompt is a surface node.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic tool-schema tokens; 0 when absent or empty.
 */
export function estimateToolsTokens(header: EpochHeader | undefined): number {
  if (header?.tools === undefined || header.tools.length === 0) return 0
  return estimateTextTokens(JSON.stringify(header.tools)) + BLOCK_OVERHEAD
}
