<!--
状态：草稿，未发布。
用途：Discussion #14451 的回复正文，供作者过目后决定是否发布。本稿确认根因、给出我们暂存分支的修复与验证范围。
核对基线：上游 master（4b399c39a6）；我们的分支 fix/desktop-stdio-epipe-guard @ 1b82043209。
注意：接手声明（claim）尚未发布，需作者明确授权后才能发帖；本稿发布前需重查讨论区有无新评论。同一缺陷的旧帖 #11809 也有草稿。
-->

# English reply (for posting to Discussion #14451)

Your diagnosis matches the source: the Electron main process has no `error` listener on `process.stdout`/`process.stderr` anywhere under `apps/desktop/src`, and Node delivers a broken pipe as an asynchronous stream `error`, outside every `try`/`catch` — including the `try` inside `DesktopUpdateCoordinator.doCheck`. `app-boot` registers `uncaughtException`/`unhandledRejection` handlers, but only for the spawned Host child process, not for the Electron main process.

We staged `fix/desktop-stdio-epipe-guard` on our fork (upstream `master` `4b399c39a6`): a small `stdio-guard` module imported first in `main.ts` attaches one `error` listener to each of `process.stdout` and `process.stderr` before any other module evaluates, marked so repeated module evaluation cannot stack listeners. Once the pipe is gone there is no consumer for the output, so the write failure is dropped; a healthy pipe is untouched. This is deliberately narrower than an `uncaughtException` fallback — it removes this crash class without masking unrelated defects.

Evidence: new `stdio-guard` spec 2/2 (listeners present, `emit('error', EPIPE)` does not throw, idempotent across `resetModules` + re-import); `main-startup` spec 187/187 with the new first import; desktop host/client `tsc -b` clean; oxlint clean; push-hook typecheck 5 gates green. We did not rebuild the packaged asar — your controlled A/B on rc.5 already covers that layer, and the patch surface is the same `lib/main.js` prologue. The second defect you noted (`dsh-chrome-control` launching `process.execPath` as node without `ELECTRON_RUN_AS_NODE`) lives outside this repository — no `chrome-control` package exists under `packages/` or `apps/` here — so we left it alone.

# 中文对照（仅供作者阅读，不发布）

你的诊断与源码一致：`apps/desktop/src` 下没有任何对 `process.stdout`/`process.stderr` 的 `error` 监听，Node 把断管以异步流 `error` 事件抛出，在所有 `try`/`catch` 之外——包括 `DesktopUpdateCoordinator.doCheck` 里的那个。`app-boot` 确实注册了 `uncaughtException`/`unhandledRejection`，但只针对 spawn 出的 Host 子进程，不是 Electron 主进程。

我们在 fork 上暂存了 `fix/desktop-stdio-epipe-guard`（上游 master `4b399c39a6`）：新增 `stdio-guard` 模块作为 `main.ts` 首个 import，在其他任何模块求值前为两条流各挂一个 `error` 监听，并用标记保证重复求值不叠加。管道断开后输出已无消费者，写入失败被丢弃；管道完好时行为不变。刻意不做 `uncaughtException` 兜底——只消除这一类崩溃，不掩盖其他缺陷。

证据：新 spec 2/2（监听存在、`emit('error', EPIPE)` 不抛出、resetModules 重复导入不叠加）；`main-startup` spec 187/187 通过；desktop host/client `tsc -b` 与 oxlint 通过；推送钩子 typecheck 5 门禁通过。我们没有重打 asar 包——你在 rc.5 上的受控 A/B 已覆盖那一层，补丁落点同为 `lib/main.js` 序言。你提到的第二个缺陷（`dsh-chrome-control` 用 `process.execPath` 当 node 且未设 `ELECTRON_RUN_AS_NODE`）不在本仓库内——`packages/`、`apps/` 下没有 `chrome-control` 包——因此未处理。
