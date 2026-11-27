<!--
状态：草稿，未发布。
用途：Discussion #14411 的回复正文，供作者过目后决定是否发布。接手声明（一行）已发布；本稿回应报告者的更新版报告（已定位元凶 dsh-error-audit 并提出三项核心诉求）。
核对基线：上游 master（4b399c39a6）与标签 dsh-v0.2.2-rc.5 的准入文件逐字节一致。
-->

# English reply (for posting to Discussion #14411)

The updated report settles it — thank you. Three parts: your plugin fix is correct, ask 2 is now implemented on our fork, and asks 1 and 3 are design decisions we would like the maintainers to weigh in on, with the trade-offs laid out below.

**Your one-line fix is the right shape.** `{kind: 'plugin:dsh-error-audit'}` is exactly the attribution the V3→V4 migration derives (`producerKind()` maps a plugin named `acme` to `plugin:acme`), so the corrected plugin matches what a migrate-then-restore round trip produces for its own rows.

**Ask 2 (report the producer) is delivered.** The admission error on our branch `fix/v4-source-admission-diagnostic` now reads, for example:

```
SessionFormatError: format v4 message requires a producer-owned source kind (tool/result seq 42: {"kind":"plugin","plugin":"dsh-error-audit"})
```

It names the checked event type, the row's sequence (omitted when a hand-built row carries none), and a bounded JSON excerpt of the observed source. The established sentence stays as the prefix, admission behavior is unchanged, and all existing substring assertions still pass. With this in place, your step-4 error would have named `dsh-error-audit` on the first occurrence. `CONTRIBUTING.md` declines external pull requests, so the branch lives on our fork and this discussion is the report-back channel.

**Asks 1 and 3 are real design decisions.** Both would stop one retired-source row from holding a session hostage; they differ in what happens to the message itself:

- Quarantine (drop or divert) keeps the log strictly conformant but silently discards the message. Most of the 353 plugins you found inject model-facing notices — a dropped notice reaches neither the model nor the log, which breaks the harness's model-visible⟺logged rule quietly. Quarantine is safe for rows nobody observes, and admission cannot tell which those are.
- Coerced append (applying `producerKind` on write) preserves the content and matches what migration would derive, but it silently rewrites third-party attribution, so a plugin shipping invalid sources never learns — and `{kind: 'plugin'}` with no `plugin` field has nothing to derive.

A middle path worth putting on the maintainers' table: keep per-row admission strict (the v4 contract is never weakened), but make the batch writer isolate a failing row instead of failing every subsequent batch — your `dsh-batch-tool-calls#5` observation is the part that turns one bad row into a permanently unusable session. The design constraint there is sequence continuity, and we have not audited the writer's retry state deeply enough to propose the mechanism; that is a maintainer-call design, like #14404.

One fact we verified on the write path that matches your Notes: `encodeEventBatch` throws before any byte is written, so the rejected row never lands and the file stays valid — the "restart fully recovers" behavior is structural, not luck.

# 中文对照（仅供作者阅读，不发布）

更新后的报告把问题定死了——感谢。分三部分：你的插件修法是对的；诉求 2 已在我们的 fork 上实现；诉求 1 和 3 是设计决定，希望维护者参与裁决，下面把取舍摆开。

**你的一行修法方向正确。** `{kind: 'plugin:dsh-error-audit'}` 正是 V3→V4 迁移派生的归属（`producerKind()` 把名为 `acme` 的插件映射为 `plugin:acme`），修正后的插件与「先迁移再还原」对其自身行的产物一致。

**诉求 2（报出生产者）已交付。** 我们分支 `fix/v4-source-admission-diagnostic` 上的准入错误现在形如：

```
SessionFormatError: format v4 message requires a producer-owned source kind (tool/result seq 42: {"kind":"plugin","plugin":"dsh-error-audit"})
```

给出受检事件类型、行序号（手工构造的无序号行会省略）、以及观察到的来源的有界 JSON 摘录。既有句子保持为前缀，准入行为不变，所有既有子串断言仍然通过。有了它，你第 4 步的错误在第一次出现时就会点名 `dsh-error-audit`。`CONTRIBUTING.md` 不接受外部 PR，分支发布在 fork，本讨论即回报渠道。

**诉求 1 和 3 是真实的设计决定。** 两者都能阻止一条退役来源的行劫持整个会话；区别在消息本身的去向：

- 隔离（丢弃或转入诊断位）让日志严格合规，但会静默丢弃消息。你找到的 353 个插件大多注入面向模型的通知——被丢弃的通知既到不了模型也进不了日志，等于无声破坏 harness 的「模型可见 ⟺ 已记录」规则。对无人观察的行隔离是安全的，而准入无法区分哪些行无人观察。
- 追加时强制改写（写入侧套用 `producerKind`）保留内容且与迁移的派生一致，但会静默改写第三方归属，写出无效来源的插件永远得不到反馈——而且 `{kind: 'plugin'}` 不带 `plugin` 字段时无从派生。

值得摆上维护者桌面的中间路线：单行准入保持严格（v4 契约不弱化），但让批量写入器隔离失败的行，而不是让后续每一批都失败——你在 `dsh-batch-tool-calls#5` 观察到的正是「一条坏行变成永久不可用会话」的那一环。那里要设计的是序号连续性约束；我们对写入器重试状态的审查还不够深，无法直接提出机制，这属于维护者裁决的设计，类似 #14404。

一个我们在写入路径上核实、与你的 Notes 一致的事实：`encodeEventBatch` 在写出任何字节之前抛出，被拒的行不会落盘，文件保持有效——「重启即完全恢复」是结构性的，不是运气。
