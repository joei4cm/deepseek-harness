<!--
Status: draft, not published.
Target: Discussion #13499.
Neither the one-line claim nor this draft has been published (the auto-mode
classifier blocked posting to #13499 without explicit user authorization);
both require the author's authorization and a fresh comment check first.
-->

# Published claim (one line)

（尚未发布）我们对照当前 `master`（`4b399c39a6`）接手了这个问题。

# English reply (draft)

Thanks for the profile and stack — it pinpoints the exact line in `SessionCorpus.load()` (`snapshotLive()` cloning every event in `session.snapshotEvents()` on every call), and matches the earlier reports in #7356 / #7434 / #8277.

We fixed this against current `master` (`4b399c39a6`) without adding a live-side LRU memo, because `Session.snapshotEvents()` already memoizes a frozen array of deeply frozen events until the next append (`packages/core/session/src/index.ts`), and every one of the six `SessionCorpus.load()` callers in `SessionQueryEngine` treats `loaded.events` as read-only and clones only what it returns:

- `SessionCorpus.load()` now returns `readonly SessionEvent[]` without cloning the whole event array: the live branch returns `session.snapshotEvents()` directly (reusing the existing `typescript/no-deprecated` site without introducing any new synchronous reader), and the persisted branch returns `readColdSessionLog().events` without a redundant second full-log clone.
- `readSession()`, `readSurface()`, and `readEvent()` reuse the already-cloned `loaded.header` instead of calling `structuredClone(loaded.header)` a second time.
- Public detachment guarantees are unchanged: `readEvent()` still clones the target and each event in `[startSeq, endSeq]` via `snapshotSessionEvent()`, `readSession()` and `readSurface()` still clone returned events, and `listEvents()` / `filterEvents()` / `traceEvent()` derive fresh records without leaking references.

On a 20,000-event live session (1 KB text per message, 100 single-event `readEvent` calls, 16-core Linux, Node v24.22.3), total wall time dropped from **8,938.9 ms (89.39 ms/read)** to **6.4 ms (0.064 ms/read)**.

The branch is `fix/session-query-live-event-clone`; upstream does not accept external pull requests, so the branch sits on our fork: https://github.com/joei4cm/deepseek-harness/tree/fix/session-query-live-event-clone

# 中文对照（仅供阅读，不发布）

感谢提供的性能剖析与调用栈——它精确指出了 `SessionCorpus.load()` 中 `snapshotLive()` 每次调用整本克隆 `session.snapshotEvents()` 的问题，并与更早的 #7356 / #7434 / #8277 一致。

我们对照当前 `master`（`4b399c39a6`）做了修复，没有在 live 侧再加一层 LRU 缓存：因为 `Session.snapshotEvents()` 本身就已经按追加缓存了深度冻结的事件快照，且 `SessionQueryEngine` 里 6 个 `SessionCorpus.load()` 调用点全部只读 `loaded.events`，并在对外返回前各自克隆所需事件：

- `SessionCorpus.load()` 将 `events` 收窄为 `readonly SessionEvent[]`，不再整本克隆：live 分支直接返回 `session.snapshotEvents()`（复用原有豁免位置，不新增任何同步历史读取入口），持久化分支直接返回 `readColdSessionLog().events`，去掉第二次整本克隆。
- `readSession()`、`readSurface()` 与 `readEvent()` 直接复用 `load()` 已克隆的 `loaded.header`，不再重复 `structuredClone(loaded.header)`。
- 对外隔离保证不变：`readEvent()` 仍对目标与窗口事件调用 `snapshotSessionEvent()`，`readSession()` / `readSurface()` 仍克隆返回事件，`listEvents()` / `filterEvents()` / `traceEvent()` 只派生新记录。

在 20,000 个事件的活跃会话上（每条约 1 KB，100 次单事件 `readEvent`，16 核 Linux，Node v24.22.3），总耗时从 **8,938.9 ms（89.39 ms/次）** 降到 **6.4 ms（0.064 ms/次）**。

分支是 `fix/session-query-live-event-clone`；上游不接受外部 PR，分支放在我们的 fork 上：https://github.com/joei4cm/deepseek-harness/tree/fix/session-query-live-event-clone
