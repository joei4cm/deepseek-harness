<!--
状态：草稿，未发布。
用途：Discussion #11809 的简短回复，说明同一缺陷已有暂存修复，并与 #14451 互相引用。#11809 由 IkariKr 补充验证（rc.1 仍未修复、try/catch 包 console 无效）。
核对基线：上游 master（4b399c39a6）；我们的分支 fix/desktop-stdio-epipe-guard @ 1b82043209。
注意：接手声明（claim）尚未发布，需作者明确授权后才能发帖；本稿发布前需重查讨论区有无新评论。
-->

# English reply (for posting to Discussion #11809)

This is still unfixed on master (`4b399c39a6`): nothing under `apps/desktop/src` listens for `error` on `process.stdout`/`process.stderr`, and the Host-side `uncaughtException` handlers in `app-boot` do not cover the Electron main process — matching @IkariKr's rc.1 probe and the try/catch experiment.

We have a staged fix on our fork, `fix/desktop-stdio-epipe-guard`: a `stdio-guard` module imported first in `main.ts` attaches one `error` listener to each stream before other modules evaluate (idempotent across re-evaluation). Your conclusion that wrapping `console.*` cannot work is right — the failure is an asynchronous stream event, not a synchronous write throw; the listener has to live on the stream itself. Details and a newer duplicate report are in #14451.

# 中文对照（仅供作者阅读，不发布）

该缺陷在 master（`4b399c39a6`）上仍未修复：`apps/desktop/src` 下没有任何对 `process.stdout`/`process.stderr` 的 `error` 监听，`app-boot` 里 Host 侧的 `uncaughtException` 处理也覆盖不到 Electron 主进程——与 @IkariKr 在 rc.1 的探针以及 try/catch 实验结论一致。

我们在 fork 上有暂存修复 `fix/desktop-stdio-epipe-guard`：`stdio-guard` 模块作为 `main.ts` 首个 import，在其他模块求值前为两条流各挂一个 `error` 监听（重复求值幂等）。你关于「给 console 包 try/catch 无效」的结论是对的——失败是异步流事件而非同步写入抛出，监听必须挂在流本身。细节与更新的重复报告见 #14451。
