<!--
状态：草稿，未发布。
用途：Discussion #14308 的回复正文，供作者过目后决定是否发布。
说明：因果假设（中止拆毁并发连接）在 Linux/Node 上未能复现，留待 Windows socket 级日志确认；防御性的只读重试已落地于 fix/desktop-welcome-invoke-retry。
-->

# English reply (for posting to Discussion #14308)

The trace narrows the failure to the startup handshake, and the two relevant paths still stand on master: `connectDesktopWelcome` uses Node `fetch`, `analyticsEnabled()`/`report()` carry one-second timeouts, and the `settings/describe` the first window needs had no retry — so a transient loopback reset on that call becomes a fatal `reconcileBackend` report.

**What landed:** `fix/desktop-welcome-invoke-retry` adds a single retry inside `connectDesktopWelcome`, scoped to read-only methods (`settings/describe`, `llm/listConfigurableProviders`, `credentials/describe`, `account/getState`, `productAnalytics/enabled`), only when the transport rejects with a `TypeError` — the `fetch failed` family this crash is one member of. Each attempt mints a fresh `rpcId`; the caller's deadline still binds the second attempt; an aborted request (your report's own timeout) is not a `TypeError` and propagates; mutations (`credentials/set`, sign-in lifecycle) stay single-attempt since an unknown outcome must never fire twice. This restores what the Chromium `net.fetch` path did for free — it retried this class of transport failure automatically.

**What is deliberately not claimed:** the connection-sharing part of the mechanism. In a loopback experiment on Linux with Node's default fetch, a delayed `report` and a concurrent `settings/describe` used different client ports, and aborting the first did not reset the second. That is not a Windows/Electron reproduction — pool behavior may differ — but it means the abort → shared-socket → ECONNRESET chain in the report should be treated as a hypothesis rather than established. If you can capture socket-correlated traces (local/remote port per request, or the backend's close/error events), the same failure tells us whether `describe` dies on its own socket (a different root cause, likely server-side connection churn) or on a shared one (your mechanism). Either way, the retry converts both variants from a crash into a retry.

**One design note worth the reviewer's eyes:** the retry is scoped to the *welcome* client, not moved into a shared fetch wrapper — the same code path also serves the long-lived account WebSocket and every later `invoke`, where retrying a mutating call would be wrong. The whitelist lives beside `invoke` so a new read-only method must opt in deliberately.

# 中文对照（仅供作者阅读，不发布）

日志把故障范围收在启动握手内，两条相关路径在 master 上依然成立：`connectDesktopWelcome` 用 Node `fetch`；`analyticsEnabled()`/`report()` 带一秒超时；首个窗口需要的 `settings/describe` 此前没有重试——所以环回上的一次瞬时连接重置会在 `reconcileBackend` 里变成致命上报。

**已落地：** `fix/desktop-welcome-invoke-retry` 在 `connectDesktopWelcome` 内部加了一次重试，只覆盖只读方法（`settings/describe`、`llm/listConfigurableProviders`、`credentials/describe`、`account/getState`、`productAnalytics/enabled`），且只在传输层以 `TypeError` 拒绝时触发——即本次崩溃所属的 `fetch failed` 一族。每次尝试换新 `rpcId`；调用方 deadline 仍约束第二次尝试；被中止的请求（report 自己的超时）不是 `TypeError`，直接传播；写操作（`credentials/set`、登录生命周期）保持单次——结果未知的调用绝不允许重发。这恢复了 Chromium `net.fetch` 曾经免费提供的同类传输失败自动重试。

**刻意不声称的：** 连接共享那半段机制。Linux 上用 Node 默认 fetch 做环回实验，延迟的 `report` 与并发 `settings/describe` 使用了不同客户端端口，中止前者并未重置后者。这不是 Windows/Electron 的复现——连接池行为可能不同——但说明报告里「中止 → 共享 socket → ECONNRESET」的链条应视为假设而非定论。如果你能拿到 socket 级日志（每个请求的本地/远端端口，或后端的 close/error 事件），同一次失败就能区分：`describe` 死在*自己的* socket 上（另一种根因，多半是服务端连接抖动）还是共享 socket 上（你的机制）。无论哪种，重试都会把两种变体从崩溃变回一次重试。

**一处值得评审者看的设计点：** 重试限定在 *welcome* 客户端内部，而不是抽成共享 fetch 包装——同一条 `invoke` 路径还服务长生命周期的 account WebSocket 和之后的每个调用，在那里对写操作重试是错的。白名单放在 `invoke` 旁边，新的只读方法需要显式 opt in。
