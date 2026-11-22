# Agent Note: Price text by the density of the script it is written in

Status: implemented

English | [中文](2026-11-23-script-aware-token-density.zh.md)

## Problem

`dsh-token-meter` priced every character at a quarter of a token. That figure matches English prose closely enough, but a provider charges CJK text about one token per character, so a Chinese session was priced at roughly a quarter of what it cost. The context indicator and the automatic compaction trigger read the same estimate, so both under-reported: a session whose next request carried 1.2 million tokens showed 24% occupancy, and compaction never started early enough to keep the request inside the window. A session that overran the window could not recover, because the compaction request carries the history it is trying to shorten.

One estimator has to serve the meter, the compaction trigger, the context breakdown, the spill policy, and the tool-result pruner, so their figures agree.

## Decision

The estimator prices each character by the density of the script it belongs to: ASCII at 0.25 tokens per character, CJK ideographs, kana, and Hangul at 0.65, CJK punctuation and fullwidth forms at 1.0, and other non-ASCII at 0.4. ASCII keeps the previous four characters per token, so every existing consumer keeps its current figure.

The densities are measured, not chosen. Against the DeepSeek-V3 byte-level BPE tokenizer and a local Qwen3.5 model tokenized by llama.cpp, over English prose, source, JSON, and this repository's own Chinese documentation, the two tokenizers agree within 5%. The mean absolute error over recorded harness sessions and the repository's content falls from 18.5% to 10.9% against DeepSeek-V3 and from 21.6% to 14.1% against Qwen3.5.

## Alternatives considered

**A per-provider exact tokenizer.** Rejected: the package already records that a per-provider tokenizer is not decided, and a tokenizer per provider would give each consumer a different figure for the same surface, which is the agreement the shared estimator exists to provide.

**Learning the density from the provider's reported usage.** Rejected: the provider reports the size of the request it answered, and a compaction answers with a summary of the whole history, so that size is not the size of the surface the estimator prices. The ratio between the two is not a density and would distort every later estimate.

**Splitting ASCII into letters, digits, punctuation, and whitespace.** Measured and not adopted: JSON punctuation costs about one token per character while English prose costs about a fifth of one, so the ASCII rate is two different rates. Splitting them buys 0.4 points of mean error against DeepSeek-V3 (10.9% to 10.5%) and 0.8 against Qwen3.5 (14.1% to 13.3%), and halves the worst under-count on recorded sessions (26% to 13%). It also moves every ASCII figure, which shifts the spill budget, the compaction threshold, and the tool-result pruning limit for every session. That trade belongs in its own change, where the moved thresholds can be reviewed together.

## Consequences

CJK text is priced within 4% of the provider's count on this repository's Chinese documentation, instead of 47% below it, so the compaction trigger and the context indicator reach their threshold at the point the provider would.

ASCII figures are unchanged. English prose remains priced about 22% above the provider and JSON and tool output about 20% below it, so an ASCII session still compacts earlier than the provider requires for prose and later than it requires for dense tool output.

The liveshare viewer fixture imports the shared estimator instead of mirroring it, so the fixture's context breakdown cannot drift from the meter's.

## Testing

`packages/llm/token-meter/tests/estimate.spec.ts` pins each script class, every CJK range, every fullwidth range, and a Chinese paragraph against the DeepSeek-V3 tokenizer's published token count.
