<!--
状态：草稿，未发布。
用途：Discussion #14274 的回复正文，供作者过目后决定是否发布。
目标渠道：上游仓库的 Discussions（上游 CONTRIBUTING 声明不接受外部 PR、Issues 已关闭，Discussions 是唯一被认可的反馈渠道）。
说明：本仓库是 fork；本回复以源码级分析与本地测试证据为主，未附代码改动，因为两处修复方向都牵涉通用包的策略归属（缓存强制写点、列表推送面），需要维护者拍板。
-->

# English reply (for posting to Discussion #14274)

I traced the whole path with your four facts against `master` (0.2.3-alpha.2), and your reading of the cold row is right — but one push path already exists and changes the picture, and your strongest diagnostic (the months-old cache file) points at a write failure rather than a missing invalidation. Here is the full map.

**What already works, with evidence**

A title change on a session that is **live in the host** is pushed end to end, and no pull is needed:

1. `session.append('session/title', …)` commits a `session/event`; the projection registry folds it eagerly (`packages/session/session-projection/src/index.ts`, `drive()`), the `title` unit's view changes, and the event-level feed fires (`onEventChanged`).
2. `SessionControlController` subscribes to that feed and broadcasts `{ type: 'projection', sessionId, seq, changes: [{ key: 'title', val }] }` on the Host-wide `session.control` stream (`packages/api/session-controller/src/control.ts:22-30`).
3. The client's `SessionManager.handleControlFrame` applies it into the per-session `ProjectionValueStore` (`packages/api/session-controller/src/client/sessions/manager.ts:624-633`); a sequenced write always beats a cached list block, `buildListSnapshot()` reads the `title` key, and the row rebuilds.

This is pinned by existing tests — `packages/api/session-controller/tests/manager.client.spec.ts:614` ("retains title projections before list arrival, keeps last-wins by seq") drives exactly a title frame into the list row — and I verified the host half on `master` with a scratch test: appending a `session/title` on a live session broadcasts a frame carrying `key: 'title'` with the new text. The renaming client's instant update is both this frame and a local echo of the rename response (`manager.ts:565`).

**Where your symptom can come from**

Two real gaps remain, plus one environmental signal:

1. **A cold session has no push path.** A session that is not live never commits events, so the drive never fires for it and no frame is broadcast. Its row's title only refreshes on the next full `session.list` pull (cold rows read the persisted cache via `cachedSnapshot(header, keys)` at `packages/api/session-controller/src/list.ts:288-289`) or when the session is opened (the follow baseline seeds the shared client store). The `api-session/*` remote events carry `added/removed/status/activity/error` — none carries a title, so nothing tells the sidebar to re-read a cold row.
2. **The persisted cache can lag a title-only event.** `SessionProjectionCache` writes durably at three mandatory points — session creation, `turn/end`, and disposal (`packages/session/session-projection-cache/src/index.ts:316-350`) — and between them only on the throttled write-behind (default shipped config: 200 events or 5 s). A title lands after its turn's `turn/end` write, so the fresh title reaches the cache through the 5 s interval, the count threshold, or a later disposal. If the host process dies inside that window (a kill, not a clean teardown that disposes sessions), the row stays at the old title until that session's next write point — which for a session that never talks again is never.
3. **Your cache-file observation is a failure signal, not the design.** With the shipped config, every committed event arms the write-behind, so a cache file whose mtime is months old while its session was recently active means the durable writes were failing on that machine. The write path is fail-soft by design: it logs `session projection cache: <trigger> write for "<id>" failed (cache stays stale)` and self-heals on the next write. That log line is worth checking before anything else — it would also explain why opening the session is the only thing that fixes the title (the live registry fold reads the log, not the cache).

**Fix directions, if the maintainers want one**

- **Cache**: make a committed event that changes a client-visible *summary* view a mandatory write point, via the same `onEventChanged` feed the control stream already consumes. That is generic (it names no domain), closes the crash window for titles and any future summary key, and mostly coalesces with the existing `turn/end` write. The cost is an extra durable write per summary-view change outside a turn, which is the maintainer's call.
- **Push**: the control stream could carry list-row refreshes for cold sessions the way it carries them for live ones — but a cold session's values cannot change while it is cold, so the real need is smaller: a list-surface event when a session's summary key changes and the session then goes cold. An `api-session/*` title event, or reusing the existing `activity` event with the summary keys attached, would let the client re-read that one row instead of a full re-list.

**What would settle it on your machine**

Two diagnostics distinguish the three explanations above:

1. Rename a session that is currently **open and connected**, without reloading the client. If the sidebar updates, the live push path works and the symptom is the cold-row/cache half; if it does not, the control stream is not reaching your client and that is a different bug.
2. After a fresh host start with no client, check whether the persisted row (`dshHomePath('storages')/session_projcache/sessions/<id>.json`) holds the new title, and whether the host log shows the fail-soft write warning.

Happy to hand over the trace or a patch for either fix direction if that is useful. I have not opened a pull request, since `CONTRIBUTING.md` states that external pull requests are not accepted.

# 中文对照（仅供作者阅读，不发布）

我把整条链路对照 `master`（0.2.3-alpha.2）源码追踪了一遍，并结合本地测试证据。你对冷行的判断是对的——但已存在一条推送链路会改变结论，而且你最有力的诊断（缓存文件 mtime 停在数月前）指向的是写入失败，而不是缺少失效机制。完整地图如下。

**已经生效的部分（附证据）**

对一个**在宿主中处于 live** 的会话，标题变更是端到端推送的，不需要任何拉取：

1. `session.append('session/title', …)` 提交一条 `session/event`；投影注册表 eagerly 折叠（`drive()`），`title` 单元的视图变化，事件级 change feed 触发（`onEventChanged`）。
2. `SessionControlController` 订阅该 feed，向 Host 级 `session.control` 流广播 `{ type: 'projection', sessionId, seq, changes: [{ key: 'title', val }] }`（`packages/api/session-controller/src/control.ts:22-30`）。
3. 客户端 `SessionManager.handleControlFrame` 把它写入按会话的 `ProjectionValueStore`（`manager.ts:624-633`）；sequenced 写入永远压过 cached 列表块，`buildListSnapshot()` 读 `title` 键，行重建。

既有测试已钉住这条链：`packages/api/session-controller/tests/manager.client.spec.ts:614`（"retains title projections before list arrival, keeps last-wins by seq"）就是把一个 title 帧推进列表行；宿主半边我在 `master` 上用临时测试验证过：对 live 会话 append 一条 `session/title` 会广播携带 `key: 'title'` 与新文本的帧。改名客户端立刻更新，既有这一帧，也有对 rename 响应的本地回显（`manager.ts:565`）。

**你的现象可能来自哪里**

剩下两处真实缺口，加一个环境信号：

1. **冷会话没有推送路径。** 不 live 的会话不会提交事件，drive 不会为它触发，也就没有帧。它的行标题只会在下一次全量 `session.list` 拉取（冷行经 `cachedSnapshot(header, keys)` 读持久缓存，`list.ts:288-289`）或打开该会话（follow 基线播种共享的客户端 store）时刷新。`api-session/*` 远程事件只有 `added/removed/status/activity/error`——没有一个带标题，所以没有任何东西提示侧栏去重读某个冷行。
2. **持久缓存可能落后于只有标题的事件。** `SessionProjectionCache` 只在三个强制写点持久化——会话创建、`turn/end`、disposal（`session-projection-cache/src/index.ts:316-350`）——中间靠节流 write-behind（出厂配置：200 个事件或 5 秒）。标题落在其所在 turn 的 `turn/end` 写之后，所以新标题要靠 5 秒 interval、计数阈值或之后的 disposal 才进缓存。如果宿主进程在这个窗口内死掉（kill，而不是会触发 session disposal 的干净退出），该行会停在旧标题，直到该会话的下一个写点——对一个不再说话的会话，那就是永远。
3. **你观察到的缓存文件是故障信号，不是设计如此。** 出厂配置下每个已提交事件都会武装 write-behind，所以一个最近活跃会话的缓存文件 mtime 停在数月前，意味着那台机器上的持久写入一直在失败。写路径是 fail-soft 的：它记录 `session projection cache: <trigger> write for "<id>" failed (cache stays stale)` 并在下一次写入时自愈。建议先查这行日志——它同样能解释为什么「点开会话」是唯一能刷新标题的动作（live 注册表折叠读的是日志，不是缓存）。

**若维护者愿意修，两个方向**

- **缓存**：把「改变 client-visible summary 视图的已提交事件」变成强制写点，复用 control stream 已经消费的同一条 `onEventChanged` feed。这是通用的（不点名任何域），同时关掉标题与未来 summary key 的崩溃窗口，并且大多与既有 `turn/end` 写合并。代价是 turn 之外每次 summary 视图变化多一次持久写，这是维护者的取舍。
- **推送**：control stream 可以像对待 live 会话那样为冷会话携带列表行刷新——但冷会话的值在冷期间不会变，所以真实需求更小：当某会话的 summary key 变化且随后转冷时，给一个列表面事件。一条 `api-session/*` 标题事件，或让既有 `activity` 事件附带 summary keys，都能让客户端只重读那一行，而不是全量 re-list。

**在你的机器上如何区分**

两个诊断可以区分上面的三种解释：

1. 对一个当前**已打开且已连接**的会话改名，不刷新客户端。若侧栏更新，live 推送路径正常，症状在冷行/缓存那一半；若不更新，control stream 没有到达你的客户端，那是另一个 bug。
2. 宿主冷启动（无客户端）后，检查持久行（`dshHomePath('storages')/session_projcache/sessions/<id>.json`）是否已含新标题，以及宿主日志是否出现 fail-soft 写入警告。

如需要，我可以交出完整追踪或任一方向的补丁。我没有开 PR，因为 `CONTRIBUTING.md` 声明不接受外部 PR。
