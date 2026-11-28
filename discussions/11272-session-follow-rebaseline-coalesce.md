<!--
Status: draft, not published.
Target: Discussion #11272.
Neither the one-line claim nor this draft has been published; posting either
requires the author's explicit authorization and a fresh comment check first.
-->

# Published claim (one line)

（尚未发布）我们对照当前 `master`（`4b399c39a6`）接手了这个问题。

# English reply (draft)

Thanks for the measurement (6,860 follow opens in 88 s) and for confirming it still reproduces on 0.2.2-rc.1. The cause is in the Client `Session.publishAssistantEntry()`: every Assistant-stream `rebaseline` (a revision, dense-index, or settlement gap for a known attempt) queued an unconditional `events.restart()`, so a sustained desync rebuilt the whole `session/follow` window once per frame.

We took the coalescing direction you suggested, against current `master` (`4b399c39a6`), inside `dsh-api-session-controller` only:

- The first rebaseline of a burst still reopens follow immediately, so a one-off desync is repaired as fast as before.
- Further rebaselines within the next 250 ms are absorbed by that reopen. When the window closes, follow reopens once more only if no fresh baseline has arrived since; otherwise the window simply closes.
- `resync()`, `disconnect()`, `dispose()`, and a failed follow stream drop the pending reopen and its timer.

We did not use a trailing-only debounce, because a continuous storm would postpone the repair indefinitely. No Remote method, frame type, or configuration key changed; delta rebaseline would need a protocol change and is left out.

With the Remote mock and fake timers, 2 s of continuous desync went from 200 follow reopens (10 ms frames) and 40 (50 ms frames) to 9 in both cases: one immediate reopen plus one per 250 ms window.

The branch is `fix/session-follow-rebaseline-coalesce`; upstream does not accept external pull requests, so it sits on our fork: https://github.com/joei4cm/deepseek-harness/tree/fix/session-follow-rebaseline-coalesce

# 中文对照（仅供阅读，不发布）

感谢提供的测量（88 秒内 6,860 次 follow 打开）以及在 0.2.2-rc.1 上的复现确认。根因在 Client 的 `Session.publishAssistantEntry()`：每条 Assistant 流 `rebaseline`（已知 attempt 的 revision、密集 index 或 settlement 缺口）都会排一次无条件的 `events.restart()`，持续失步时每帧都重建整个 `session/follow` 窗口。

我们按你建议的合并方向，对照当前 `master`（`4b399c39a6`）只改了 `dsh-api-session-controller`：

- 一串 rebaseline 中的第一条仍立即重开 follow，单次失步的修复速度不变。
- 其后 250 ms 内的 rebaseline 被这次重开吸收；窗口关闭时，只有在此期间没有收到新 baseline 才再重开一次，否则窗口直接关闭。
- `resync()`、`disconnect()`、`dispose()` 以及 follow 流失败都会丢弃待执行的重开及其计时器。

我们没有采用纯尾随防抖，因为持续风暴会让修复无限推迟。Remote 方法、帧类型与配置项都没有变化；增量 rebaseline 需要改协议，本次不涉及。

在 Remote mock 与假计时器下，2 秒持续失步的 follow 重开次数从 200 次（10 ms 帧间隔）和 40 次（50 ms 帧间隔）都降到 9 次：首帧立即 1 次，加上每个 250 ms 窗口 1 次。

分支是 `fix/session-follow-rebaseline-coalesce`；上游不接受外部 PR，分支放在我们的 fork 上：https://github.com/joei4cm/deepseek-harness/tree/fix/session-follow-rebaseline-coalesce
