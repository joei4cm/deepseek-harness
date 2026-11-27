<!--
状态：草稿，未发布。
用途：Discussion #14454 的回复正文，供作者/维护者过目后决定是否发布。本稿确认根因、给出我们暂存分支的修复与验证范围。
核对基线：上游 master（4b399c39a6）；我们的分支 fix/client-hmr-asar-watch @ 92193526db。
注意：接手声明（claim）尚未发布，需作者明确授权后才能发帖；本稿发布前需重查讨论区有无新评论。
-->

# English reply (for posting to Discussion #14454)

Your stack sample and the disable-A/B pin it precisely: `setInterval(pollWatches, 500)` → `bundleStat` → `statSync` over all 113 rows, every one inside `app.asar`. Two facts make this pure waste on packaged builds: files inside an asar archive are immutable for the process lifetime (the archive is replaced wholesale on update, never mutated in place), and `app.asar.unpacked` siblings are real files that still get watched.

We staged `fix/client-hmr-asar-watch` on our fork (upstream `master` `4b399c39a6`): `syncWatches` now skips baselines whose path contains an `.asar/` segment, but only when the process is actually Electron — `process.versions.electron` (main process) or `ELECTRON_RUN_AS_NODE=1` (the Desktop Host child, which `desktopNodeEnvironment` spawns with exactly that selector). Plain-Node `dsh web` and dev builds keep watching `*.asar`-named directories as ordinary paths, and `pluginEvents`/`rebuilt` semantics are untouched — an immutable bundle could never produce a rebuild notification anyway.

Evidence: `packages/client/hmr` suite 3 files / 17 tests with 100% coverage of `src/`; three new node-half cases cover the Electron env-var path, the Electron main-process path (`process.versions.electron`), and the plain-Node control; with master's `index.ts` restored the asar case fails (negative control); host aggregate typecheck, oxlint, and the push-hook gates pass. We could not run a packaged macOS build here — your inspector capture and disable-A/B already cover that layer, and the patch removes exactly the `statSync` calls your sample caught. Alternatives we rejected: raising `pollIntervalMs` (treats the symptom, penalizes dev HMR) and a config opt-out (the waste is structural, not a deployment preference).

# 中文对照（仅供作者阅读，不发布）

你的调用栈采样和禁用 A/B 把根因钉得很准：`setInterval(pollWatches, 500)` → `bundleStat` → 对全部 113 行 `statSync`，且每个路径都在 `app.asar` 内部。打包构建上这是纯浪费，原因有二：asar 归档内部文件在进程生命周期内不可变（更新时整个归档被替换，不会原地改写），`app.asar.unpacked` 旁系是真实文件、仍照常监听。

我们在 fork 上暂存了 `fix/client-hmr-asar-watch`（上游 master `4b399c39a6`）：`syncWatches` 现在跳过路径含 `.asar/` 段的 baseline，但仅在进程确实是 Electron 时——`process.versions.electron`（主进程）或 `ELECTRON_RUN_AS_NODE=1`（Desktop Host 子进程，`desktopNodeEnvironment` 正是用这个选择器 spawn 的）。纯 Node 的 `dsh web` 和开发构建仍把 `*.asar` 命名目录当普通路径监听，`pluginEvents`/`rebuilt` 语义不变——不可变的 bundle 本来就不可能产生重建通知。

证据：`packages/client/hmr` 全套 3 文件 / 17 用例，`src/` 覆盖率 100%；三个新 node-half 用例分别覆盖 Electron env 路径、Electron 主进程路径（`process.versions.electron`）和纯 Node 对照；还原 master 的 `index.ts` 后 asar 用例失败（负控）；host 聚合 typecheck、oxlint、推送钩子门禁通过。我们这边没有 macOS 打包产物可跑——你的 inspector 采样和禁用 A/B 已覆盖那一层，本补丁移除的正是采样抓到的那些 `statSync`。我们考虑过并放弃的方案：调大 `pollIntervalMs`（治标且拖累开发 HMR）和加配置开关（浪费是结构性的，不是部署偏好）。
