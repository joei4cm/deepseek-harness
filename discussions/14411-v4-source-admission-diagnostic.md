<!--
状态：草稿，未发布。
用途：Discussion #14411 的回复正文，供作者过目后决定是否发布。接手声明（一行）已发布。
核对基线：上游 master（4b399c39a6）与标签 dsh-v0.2.2-rc.5 的同一文件逐字节一致。
-->

# English reply (for posting to Discussion #14411)

Thank you for the complete report — the stack and the 32-occurrence record narrow this a lot. Here is what the code establishes, what we could not find, and what we shipped to make the next occurrence conclusive.

The check that fails is deliberately narrow: on both the write path (`encodeEvent` → `assertV4RowAdmission` → `assertV4SourceRowAdmission`) and your `0.2.2-rc.5` build, it throws only when a message's `source.kind` is the retired `'plugin'` wrapper. Your stack going through `source()` therefore proves your runtime submitted a message row carrying `source: {kind: 'plugin', …}` inside an encoded batch.

We audited every production append site for the six checked event types in both the current `master` tree and the `dsh-v0.2.2-rc.5` tree, and none of them writes a retired source:

- `tool/result`: the batch commit, the compaction pruner's replacement, and the interruption recovery all stamp `{kind: 'tool', callId}`.
- `user/message`: the loop's runtime-context projection and the compaction checkpoint (`compact-checkpoint`).
- `system/message` / `assistant/message`: assembly and provider/model attribution.
- `agent/inbox/spliced` `inserted`: controller attribution `{kind: 'user', rpcId}`.
- `session/title-llm-request`: `{kind: 'dsh-session-title-llm'}`.

The only in-tree producer of `'plugin'` message sources is the V2→V3 migration, which is migration-tier output, not runtime appends. So the poisoned row in your sessions most likely came from something in your composition outside that audit — consistent with #14408, where desktop auto-update leaves the exact-pinned profile bundles stale, so a pre-V4 plugin could still be stamping V3-era sources.

What we shipped: the admission error now names the checked event type and the observed source, so the next occurrence identifies the writer directly, for example `format v4 message requires a producer-owned source kind (tool/result: {"kind":"plugin","plugin":"<name>"})` instead of the bare sentence. The established sentence stays as the prefix; admission behavior is unchanged. It is on our fork as branch `fix/v4-source-admission-diagnostic` (`CONTRIBUTING.md` declines external pull requests, so we publish branches there and report here).

Two asks that would let us close the root cause rather than the diagnostic:

1. The output of `dsh plugin list` (or the desktop plugin panel) for the affected installation, including any experimental plugins.
2. If you still have one of the 8 affected sessions, its exact error text after upgrading to a build with the diagnostic — the plugin name should appear in the message.

Your recovery observation matches the code: nothing was written to disk, the poisoned row lived only in the queued runtime state, and a restart clears it.

# 中文对照（仅供作者阅读，不发布）

感谢完整的报告——栈与 32 次记录把范围收得很窄。以下是代码能确立的结论、我们没能找到的东西，以及为让下一次复现可定位而交付的改动。

抛错的检查刻意收窄：在写入路径（`encodeEvent` → `assertV4RowAdmission` → `assertV4SourceRowAdmission`）上，且在你的 `0.2.2-rc.5` 构建中，它只在消息的 `source.kind` 是退役的 `'plugin'` 包装时抛出。你的栈经过 `source()`，因此可以证明你的运行时在某个编码批次里提交了携带 `source: {kind: 'plugin', …}` 的消息行。

我们核查了当前 `master` 树与 `dsh-v0.2.2-rc.5` 树中六类受检事件的全部生产追加点，没有任何一处写出退役来源：

- `tool/result`：批次提交、压缩剪除的替换行、中断恢复都标 `{kind: 'tool', callId}`。
- `user/message`：循环的运行时上下文投影与压缩检查点（`compact-checkpoint`）。
- `system/message` / `assistant/message`：装配与提供方/模型归属。
- `agent/inbox/spliced` 的 `inserted`：控制器归属 `{kind: 'user', rpcId}`。
- `session/title-llm-request`：`{kind: 'dsh-session-title-llm'}`。

树内唯一的 `'plugin'` 消息来源产出者是 V2→V3 迁移，属迁移层产物而非运行时追加。所以你这些会话里的污染行最可能来自上述核查之外的组合成分——与 #14408 一致：桌面自动更新会把精确固定的 profile 捆绑留在过期版本上，V4 之前的插件仍可能在写 V3 时代的来源。

我们交付的改动：准入错误现在会给出受检事件类型与观察到的来源，下一次复现可直接指出写入者，例如 `format v4 message requires a producer-owned source kind (tool/result: {"kind":"plugin","plugin":"<名称>"})`，不再是裸句子。既有句子保持为前缀，准入行为不变。改动在我们 fork 的 `fix/v4-source-admission-diagnostic` 分支上（`CONTRIBUTING.md` 不接受外部 PR，因此分支发布在 fork 并在此报告）。

两个能让我们关闭根因而不仅是诊断的请求：

1. 受影响安装上 `dsh plugin list`（或桌面插件面板）的输出，包括实验插件。
2. 若仍保留 8 个受影响会话之一，升级到带诊断的构建后复现一次并给出完整错误文本——插件名应直接出现在消息里。

你观察到的恢复方式与代码一致：磁盘未写入任何内容，污染行只存在于排队中的运行时状态里，重启即清空。
