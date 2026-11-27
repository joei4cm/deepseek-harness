<!--
状态：草稿，未发布。
用途：Discussion #14413 的回复正文，供作者过目后决定是否发布。分析性回复，不接修复。
核对基线：上游 master（4b399c39a6）。
-->

# English reply (for posting to Discussion #14413)

A code-and-records map for your three questions; the design calls themselves stay with the maintainers.

**What ships today.** The policy package is intact and mounted-but-disabled on the `dsh-base` row: with `disabled: false` every mutating tool is guarded again (`write` refuses an unread file, `edit` refuses an unread or externally changed file with `FS_STALE_VERSION`, `apply_patch` refuses an unread target), and one profile-patch line restores it per deployment. Review capture, sandbox confinement, and the `fs/observed` events are unchanged by the default-off switch. The `write` and `edit` tool guidance still asks the model to read before modifying; it just no longer cites the policy. Sources: the [upgrade guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/fs-observation-policy-default-off/guide.md) and the [defaults Agent Note](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-10-29-shipped-fs-mutation-defaults.md).

**Q1 — what the decision record contains.** The note records the form of the rationale: benchmark runs of the shipped compositions with the tool enabled and with the policy disabled were compared against the baseline, and the defaults were decided from those results in discussion between the maintainers. The benchmark numbers themselves are not recorded in the note. Your listed frictions are, however, structural facts in the code, not anecdotes: the observation state is an in-memory `WeakMap` keyed by owner-to-agent-session (`packages/fs/fs-observation-policy/src/index.ts`, the `observed` field), a plugin reload replaces it wholesale, and a restart or session restore starts every file unseen — so "state lost after restore, then blocked until a re-read" is the designed behavior of the shipped state model, and the extra `Read` round-trips follow from it.

**Q2 — fix state management instead?** The recorded alternative is instructive about the maintainers' axis preference: a variant that left `write`/`edit` guarded while exempting only `apply_patch` was built and evaluated, and rejected for adding a second configuration axis beside the policy row — one row deciding all three tools was preferred. Your direction is different and maps onto existing machinery: persisting observations across restore would be a session projection (the harness has an established projection pattern), and returning the current file state on a failed check would fold the recovery `Read` into the refusal. Both are plausible; both change what the guard's authorizations mean across process lifetimes, so they are maintainer decisions, and this discussion is the right channel to make the case.

**Q3 — protection for `write` overwrites without the policy.** Today, with the row disabled: `write` overwrites unconditionally; `edit` keeps an implicit, narrow protection (its unique-literal-match requirement fails when the target text changed); `apply_patch` keeps partial implicit protection (a hunk applies only where its context still matches). There is no separate write-only freshness check or concurrency guard in the shipped tree, and the policy's own documented limit cuts the other way: authorization is version freshness, not view completeness — a windowed read authorizes a full-file overwrite of an unchanged file ([policy README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/fs-observation-policy/README.md)). A dedicated concurrent-modification guard for `write` would be new surface; the `fs/observed` events still flow, so a consumer could build one without touching the tools.

# 中文对照（仅供作者阅读，不发布）

针对你的三个问题，给出代码与决策记录的对照；设计裁决本身留给维护者。

**现状。** 策略包完好，在 `dsh-base` 行上挂载但关闭：`disabled: false` 一行即可让所有变更工具恢复防护（`write` 拒绝未读文件，`edit` 对未读或外部已变的文件报 `FS_STALE_VERSION`，`apply_patch` 拒绝未读目标）；Review 捕获、沙箱约束、`fs/observed` 事件均不受默认关闭影响。`write` 与 `edit` 的工具指引仍要求先读，只是不再引用该策略。依据：升级指南与默认值 Agent Note。

**问题 1——决策记录里有什么。** 记录的依据形式是：对出货组合在启用与禁用两种状态下做基准对比，默认值由维护者依据结果讨论决定；具体数字未记入笔记。你列举的摩擦在代码中是结构性事实而非轶闻：观测状态是按「属主→Agent 会话」键控的内存 `WeakMap`（`packages/fs/fs-observation-policy/src/index.ts` 的 `observed` 字段），插件重载整体替换，重启或会话恢复后所有文件回到未观测——「恢复后状态丢失、重读前被拦」是现有状态模型的设计行为，额外的 `Read` 往返由此而来。

**问题 2——修状态管理而不是整体关闭？** 记录在案的备选方案能说明维护者对配置轴的偏好：曾构建并评估过「仅豁免 `apply_patch`、保留 `write`/`edit` 防护」的变体，因在策略行之外增加第二配置轴被否——一行决定三个工具更受青睐。你的方向不同且能映射到既有机制：跨恢复持久化观测对应会话投影（harness 有成熟的投影模式）；检查失败时随拒绝返回当前文件状态，相当于把恢复性的 `Read` 折进拒绝里。两者都可行，也都会改变防护授权跨进程生命周期的含义，属维护者裁决，本讨论正是提出论证的合适渠道。

**问题 3——无策略时 `write` 覆盖的保护。** 行关闭时：`write` 无条件覆盖；`edit` 保留一条窄的隐式保护（唯一字面匹配的要求在目标文本已变时失败）；`apply_patch` 保留部分隐式保护（hunk 只在其上下文仍然匹配处应用）。出货树中没有独立的 write 新鲜度检查或并发修改防护；策略自身记载的局限还偏向另一侧：授权依据是版本新鲜度而非视图完整性——一次窗口化读取即可授权对未变文件的整体覆盖（[策略 README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/fs-observation-policy/README.md)）。专门的 `write` 并发防护会是新表面；`fs/observed` 事件仍在派发，消费者可以不改工具自行构建。
