<!--
状态：草稿，未发布。
用途：Discussion #14271 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/desktop-forward-transport-502` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）。
-->

# English reply (for posting to Discussion #14271)

Implemented on my fork (`fix/desktop-forward-transport-502`, verified against current `master` `4b399c39a6`):

- `forwardWebRequest` now answers `502` for any `fetch` rejection between the main process and the Host, instead of letting it reject through `protocol.handle` into `installFailLoud`. One reset is now one failed request, not an app exit. Streaming, cancellation, connection-header withholding and the plugin-bundle `no-store` override are unchanged, and the failure is logged through `console.error` — except when the renderer already aborted that request, which reports itself.
- The second candidate you named needs nothing: on master the startup authenticate fetch already settles through `host-process.ts`'s `.deliver(...).catch(...)` path — the bundled 0.2.2-rc.5 source differs from master here, which is probably why `authenticateWebHost` still looks exposed in the asar.

Confirmed on master that `forwardWebRequest` is the only remaining production `fetch` with nothing to receive its rejection (`file-actions.ts` is inside a `try`, `policy-test-auth.ts` is a test helper).

Tests: two new cases in `web-document.spec.ts` (502 on transport failure, no log for an already-aborted request); the 502 case fails against the pre-fix source (rejection escapes). All 168 desktop spec files / 2119 cases pass, plus build/typecheck/lint.

One scope note: this removes the crash vector for the proxy path only. Any *other* module that leaves a `fetch` (or any promise) unhandled still reaches `installFailLoud` — that is the deliberate policy you and the thread settled, so per-request owners remain the right fix points rather than a general allowlist.

# 中文对照（供作者参考）

已在 fork 上实现（`fix/desktop-forward-transport-502`，基于当前 `master` `4b399c39a6` 验证）：

- `forwardWebRequest` 现在对主进程与 Host 之间的任何 `fetch` rejection 应答 `502`，不再让它穿透 `protocol.handle` 到达 `installFailLoud`。一次重置现在只是一个请求失败，而不是应用退出。流式转发、中止、连接级响应头丢弃与插件 bundle 的 `no-store` 改写不变；失败会经 `console.error` 记录——渲染侧已中止的请求除外，它自己已经说明了。
- 你提到的第二处候选不需要改：master 上启动认证 fetch 已经走 `host-process.ts` 的 `.deliver(...).catch(...)` 收敛路径——0.2.2-rc.5 的 asar 与 master 不同，这大概就是 `authenticateWebHost` 看起来仍暴露的原因。

已确认 master 上 `forwardWebRequest` 是唯一没有接收方的生产 `fetch`（`file-actions.ts` 在 `try` 内，`policy-test-auth.ts` 是测试工具）。

测试：`web-document.spec.ts` 新增两例（传输失败应答 502；已中止请求不记录日志）；502 用例在修复前源码上按预期失败（rejection 穿透）。desktop 全部 168 个 spec 文件 / 2119 用例通过，另有 build/typecheck/lint 全过。

一处范围说明：这只堵住了代理路径的崩溃向量。任何*其他*模块留下未处理的 `fetch`（或任何 promise）仍会到达 `installFailLoud`——这是讨论中确认过的既定策略，所以按请求归属逐点接住仍是正确修法，而不是通用白名单。
