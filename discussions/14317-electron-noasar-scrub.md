<!--
状态：草稿，未发布。
用途：Discussion #14317 的回复正文，供作者过目后决定是否发布。
说明：已按 reporter 建议 2+3 落地 harness 侧防御修复（scrub + runner stderr tail），分支 fix/subprocess-electron-noasar-leak 已推 fork；写入方在仓库源码之外，故建议 1 无法从本仓库落地。
-->

# English reply (for posting to Discussion #14317)

Superb differential evidence — the four-environment matrix nails it to the single variable. One source-side note and the fix that follows from it:

**Where the variable is written is outside this repository's sources.** Searched the whole tree and the packaged dependency set for `ELECTRON_NO_ASAR`: nothing writes it. The ~0.7 s-after-plugins-load timing points at the desktop installer's runtime preparation (which mutates `process.env` for its Node-mode children and doesn't restore), so "stop letting it leak" (suggestion 1) can't land from this tree — it belongs to the packaging side.

**Suggestions 2 and 3 are implemented** on `fix/subprocess-electron-noasar-leak`:

- `scrubbedParentEnv` (the one scrub every harness child starts from) now also drops `ELECTRON_NO_ASAR`, case-insensitively. `ELECTRON_RUN_AS_NODE` deliberately survives — it is the mode selection that makes the packaged Electron binary behave as Node, so the runner spawned through `process.execPath` still needs it. An explicit `spec.env` entry merges after the scrub, so a caller that genuinely wants asar disabled can still forward it.
- `runnerStdio` pipes the runner's own fd 2 instead of ignoring it, and `launchWindowsJob` keeps a bounded (4 KiB) tail appended to the `SUBPROCESS_RUNNER_FAILED` message. Under the same failure the error now reads `Windows Job runner exited with exit code 1 ... : Error: Cannot find module '...app.asar\...\runner.js'` — the dead end becomes a one-minute diagnosis. Settlement waits for the stderr stream to close so the tail is complete.

Caveat on coverage: this was developed and tested on Linux (unit tests cover the scrub and the stderr-tail path; the Windows Job matrix runs in CI). The end-to-end asar path is Windows-packaging-only, so a confirmation that your four-way repro now yields `ASAR-OK` for the scrubbed row — or simply that tools come back on the next nightly — would close the loop. Your profile-plugin workaround stays valid in the meantime, and remains the only mitigation for the sibling problem that nothing in this change fixes: other places the desktop writes the variable late.

# 中文对照（仅供作者阅读，不发布）

差分证据非常出色——四组环境对照把根因钉死在单个变量上。源码侧一点说明，以及由此落地的修复：

**变量写入方不在本仓库源码内。** 全树及打包依赖集都搜过 `ELECTRON_NO_ASAR`：没有任何地方写它。插件加载后约 0.7 秒出现的时序指向桌面安装器的运行时准备阶段（它为自己的 Node 模式子进程改 `process.env` 且未还原），所以「阻止泄漏」（建议 1）无法从本仓库落地——属于打包侧。

**建议 2 与 3 已实现**，位于 `fix/subprocess-electron-noasar-leak`：

- `scrubbedParentEnv`（每个 harness 子进程的公共基线）现在额外丢弃 `ELECTRON_NO_ASAR`，大小写不敏感。`ELECTRON_RUN_AS_NODE` 有意保留——它是让打包 Electron 二进制按 Node 运行的模式开关，经 `process.execPath` 启动的 runner 仍需要它。显式 `spec.env` 条目在 scrub 之后合并，确需关 asar 的调用方仍可转发。
- `runnerStdio` 把 runner 自身 fd 2 由 `ignore` 改为管道，`launchWindowsJob` 保留有界（4 KiB）尾部并附进 `SUBPROCESS_RUNNER_FAILED` 消息。同样的故障下错误现在会带 `Cannot find module '...app.asar\...\runner.js'`——死胡同变成一分钟定位。结算会等 stderr 流关闭以保证尾部完整。

覆盖范围的保留说明：修复在 Linux 上开发与测试（单测覆盖 scrub 与 stderr-tail 路径；Windows Job 矩阵由 CI 承担）。端到端 asar 路径是 Windows 打包形态专属，如果你在下一版 nightly 上用四组对照验证 scrub 行得到 `ASAR-OK`、或工具直接恢复，就闭环了。你的 profile 插件绕过方式依然有效，而且对本次修复覆盖不了的姊妹问题——桌面临写该变量的其他途径——仍是唯一缓解。
