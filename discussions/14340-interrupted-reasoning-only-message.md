<!--
状态：草稿，未发布。
用途：Discussion #14340 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/llm-deepseek-reasoning-only-history` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（8bd073392e）；引用的行号与序列化逻辑在当前代码树逐条核对过。
-->

# English reply (for posting to Discussion #14340)

Your root-cause chain checks out exactly on current `master`: `agent.ts:493` persists the cancelled prefix whenever `interruptedBlocks()` is non-empty (and `cancel.spec.ts:675` asserts the reasoning-only case deliberately — that design is worth keeping), while `serialize.ts` only skips assistant messages whose converted content is empty. A reasoning-only message converts to `[{type:"thinking"}]`, passes the emptiness check, and leaves as a thinking-only assistant turn that a strict Anthropic-Messages-compatible endpoint rejects whole. Your provider-level matrix matches too: the trigger is the missing `text`/`tool_use` block, not the cancellation.

I implemented your preferred option on a fork branch (`fix/llm-deepseek-reasoning-only-history`, based on upstream `master`):

- **Serialization omits any assistant message that carries neither a `text` nor a `tool_use` block, signed or not.** The durable `assistant/message` and its transcript stay untouched; only the request omits the unrepresentable turn. Adjacent user turns merge the way the existing empty-message omission already merges them, and the system-update flush behaves exactly as it does at an omitted empty assistant message.
- I applied the rule uniformly to signed thinking-only turns as well (your option 1's sketch does the same): a completed stop with only reasoning is equally unrepresentable as a conversational turn, and one contract — "a Messages turn has text or tool use" — avoids keeping a signed/unsigned branch alive in the serializer. Your matrix doesn't cover the signed-only shape, so if a strict endpoint accepts signed thinking-only history and you'd rather preserve it, the rule narrows in one line; the uniform form is what I could verify end to end here.
- Your option 2 (persisting the prefix as `assistant/attempt`) is left alone: it would lose the visible prefix the cancelled-stream design deliberately keeps.

One fixture note: eleven existing replay-degradation variants and one foreign-history assertion used a reasoning-only message as their minimal fixture to assert that degraded (unsigned) thinking still serializes. Under the new contract those messages are omitted, so their fixtures gained a text block with a matching replay entry — I traced each variant's failing validation branch (object parse, block count, type mismatch, signature validation) and confirmed each still fails for the same reason, so the degradation coverage is unchanged in substance.

The regression tests replay your scenario directly — an interrupted reasoning-only prefix between two user turns serializes to a single merged user message — and fail against the pre-fix serializer. The full llm-deepseek suite (714 tests), the one recorded-session snapshot whose log contains a reasoning-only message, typecheck, lint, and the doc gates pass; the branch and a full pull-request description are ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

# 中文对照（仅供作者阅读，不发布）

你的根因链在当前 master 上逐条成立：`agent.ts:493` 在 `interruptedBlocks()` 非空时就持久化被取消的前缀（`cancel.spec.ts:675` 恰好断言了 reasoning-only 情形——这个设计值得保留），而 `serialize.ts` 只跳过「转换后内容为空」的 assistant 消息。reasoning-only 消息转换成 `[{type:"thinking"}]`，通过空判定，以 thinking-only assistant 轮次发出，被严格的 Anthropic-Messages 兼容端点整条拒绝。你 provider 层的矩阵也对：触发条件是缺 `text`/`tool_use` 块，不是取消本身。

我把你的首选方案实现在 fork 分支（`fix/llm-deepseek-reasoning-only-history`，基于上游 master）：

- **序列化整条省略不含任何 `text` 或 `tool_use` 块的 assistant 消息，无论有无签名。** 持久 `assistant/message` 与界面 transcript 原样保留；只有请求省略这个无法表达的轮次。相邻 user 轮次的合并行为与既有空消息省略一致，system 更新的冲刷位置也与「在空 assistant 消息处不冲刷」完全相同。
- 该规则同样统一适用于已签名的 thinking-only 轮次（你方案 1 的草图同样如此）：以 `stop` 结束却只产出 reasoning 的完成轮次同样不是可表达的对话轮次，单一契约「Messages 轮次必须有 text 或 tool use」避免序列化器里长期保留一条有无签名的分支。你的矩阵没有覆盖 signed-only 形态——如果严格端点其实接受签名 thinking-only 历史且你希望保留，规则收窄只需一行；统一形态是我在本机能够端到端验证的那一种。
- 你的方案 2（前缀改落 `assistant/attempt`）没有实施：会丢失取消流设计特意保留的可见前缀。

一个 fixture 说明：既有 11 个回放退化变体和一条外来历史断言用 reasoning-only 消息作最小 fixture，断言「退化（无签名）的 thinking 照样序列化」。新契约下这类消息整条省略，因此 fixture 各补一个 text 块与对应回放条目——我逐变体核对过各自命中的校验分支（对象解析、块计数、类型不匹配、签名校验）保持不变，退化覆盖实质未变。

回归测试直接重放你的场景——两个 user 轮次之间的中断 reasoning-only 前缀序列化成一条合并的 user 消息——对 pre-fix 序列化器失败。llm-deepseek 全套（714 个用例）、唯一含 reasoning-only 消息的录制快照场景、typecheck、lint、doc 门禁通过；分支与完整 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。
