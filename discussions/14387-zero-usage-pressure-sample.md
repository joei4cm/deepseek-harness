<!--
状态：草稿，未发布。
用途：Discussion #14387 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/token-meter-zero-usage-sample` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）；引用的行号与投影逻辑在当前代码树逐条核对过。
-->

# English reply (for posting to Discussion #14387)

Your root-cause chain checks out line by line on current `master`: the pi-ai adapter's in-stream error path emits the untouched all-zero usage skeleton, `llm-pi-ai`'s `stream.ts` converts it into a `usage` chunk unconditionally, `usageOf()` samples it for `assistant/attempt` without discriminating, and the context-pressure fold both overwrites `pressureTokens` and advances `sampledSurfaceTokens` — so `projectedTokens` cancels to 0 while the breakdown heuristic still reads ~330k. The `assistant/message` fallback, the `??` in `context-occupancy.ts`, and the self-recovery on the next real sample all match what you measured.

I implemented your suggestions 2 and 3 together on a fork branch (`fix/token-meter-zero-usage-sample`, based on upstream `master`), because the zero-value guard already implies the bound sampling advance:

- **`usageOf()` now returns `undefined` for a settlement whose usage reports no real token count** — `pressureFrom(usage) === 0 && outputTokens === 0` means the skeleton reports nothing. Such a settlement touches neither `pressureTokens` nor `sampledSurfaceTokens`, so the last real sample stands and the surface movement since then keeps feeding the projected correction term. A settlement carrying partial counts (e.g. `inputTokens: 0, outputTokens: 6`, the "rejected after some tokens flowed" case you flagged) still counts.
- The guard lives in the shared `usageOf()`, so the `tokenUsage` projection also stops recording an empty bucket in its `last` slot — the "minor" row in your impact table is covered too. Its `totals` were unaffected before and remain so.
- **Why the projection layer rather than the adapter**: it is provider-agnostic (any adapter taking the in-stream error path is covered), it applies when replaying logs already written with the skeleton (an adapter-level fix cannot retract what older versions persisted), and the durable log stays faithful to what the adapter emitted. With that, suggestion 1 becomes a separate optional cleanup; suggestions 4 and 5 are left for the client/UX layer.

Cached `contextPressure` states that already hold `pressureTokens: 0` are not migrated (`stateVersion` stays at 6): they self-correct the moment the next real sample lands, same as before. The regression test replays your exact scenario — real sample → failed settlement with the `{0,0,0}` skeleton + error finish → and asserts `pressureTokens` stays at the last real value and `projectedTokens` keeps counting surface growth; the case fails against the pre-fix fold. The full token-meter suite (138 tests), typecheck, lint, and doc gates pass; this machine is Linux, so the Desktop ring itself is demonstrated by the projection tests rather than a live client.

The branch and a full pull-request description are ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

# 中文对照（仅供作者阅读，不发布）

你的根因链在当前 master 上逐条核对成立：pi-ai 适配器的 in-stream error 路径携带了从未更新的全零 usage 骨架，`llm-pi-ai` 的 `stream.ts` 无条件把它转成 `usage` chunk，`usageOf()` 对 `assistant/attempt` 不加甄别地取样，context-pressure 折叠既覆盖 `pressureTokens` 又推进 `sampledSurfaceTokens`——于是 `projectedTokens` 抵消归零，而启发式分解仍读约 33 万。`assistant/message` 回退、`context-occupancy.ts` 的 `??`、以及下一次真实采样的自愈都与你实测一致。

我把建议 2 与 3 合起来实现在 fork 分支（`fix/token-meter-zero-usage-sample`，基于上游 `master`），因为零值守卫本身即隐含「不推进采样点」：

- **`usageOf()` 对不携带真实计数的结算返回 `undefined`**——`pressureFrom(usage) === 0 && outputTokens === 0` 表示该骨架没有报告任何量。这样的结算既不碰 `pressureTokens` 也不碰 `sampledSurfaceTokens`，上一次真实采样保持原位，其后的 surface 增量继续喂入投影修正项。携带部分计数的结算（如 `inputTokens: 0, outputTokens: 6`，你警示的「部分 token 已消耗后被拒」）仍正常采样。
- 守卫放在共享的 `usageOf()`，`tokenUsage` 投影也一并不再在 `last` 槽位记录空桶——你影响表里的「轻微」一项同步修复；其 `totals` 改前改后都不受影响。
- **选择投影层而非适配器层的原因**：与提供方无关（任何走 in-stream error 路径的适配器都被覆盖）、重放已写入骨架的旧日志时同样生效（适配器级修复无法回溯旧产物），且持久日志保持事件原文。建议 1 因此降为可选的独立清理，建议 4/5 留给客户端/UX 层。

已污染的 `contextPressure` 缓存状态不做迁移（`stateVersion` 保持 6）：与现状一样，下一次真实采样落地即自行修正。回归测试完整重放你的场景——真实采样 → 携带 `{0,0,0}` 骨架 + error finish 的失败结算——断言 `pressureTokens` 保持上一次真实值、`projectedTokens` 继续计数 surface 增量；该用例对 pre-fix 折叠失败。token-meter 全套（138 个用例）、typecheck、lint、doc 门禁通过；本机是 Linux，占用环的展示效果由投影测试而非真实客户端演示。

分支与完整的 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。
