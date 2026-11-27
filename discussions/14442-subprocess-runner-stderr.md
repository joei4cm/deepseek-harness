<!--
Status: draft, not published.
Target: Discussion #14442.
Do not publish without explicit user authorization and a fresh check for new comments.
-->

# English reply (draft)

We took this on against current `master` (`4b399c39a6`) and confirmed the diagnostic gap you describe: `runner-launch.ts` `runnerStdio()` ignores the runner's own fd 2, so a runner killed or crashed before it can prove its managed range empty leaves only a bare decimal exit status in the `SUBPROCESS_RUNNER_FAILED` message, and the Node fatal or module-load text is discarded.

Our branch is `fix/subprocess-runner-stderr-diagnostic` (`3dc25892948fd2bf629d7eed22fa9d6e7b46de22`), written from your report rather than from your comparison branch — we did not cherry-pick `Ruiyi-Zhang-BUPT:fix/subprocess-runner-stderr-diagnostic`.

The implementation matches your proposal:

- `runnerStdio()` pipes the runner's fd 2. fd 0/1 stay ignored, fd 3 stays IPC, fd 4–6 carry the target's stdio, fd 7 stays the control channel.
- `windows-job.ts` keeps the last 4 KiB of that stream. A truncation can only remove a lead byte, so an invalid sequence can only sit at the start; it decodes as replacement characters and the decode drops them, then trims. An empty tail leaves the message byte-identical to before.
- Both `SUBPROCESS_RUNNER_FAILED` messages — the range-settlement one and the failed-after-it-started one — append `; runner stderr: <tail>` when there is a tail, and an exit code now prints its unsigned 32-bit decimal and hexadecimal values (`exit code 3221226505 (0xC0000409)`). The fail-closed condition and the result settlement are untouched; `signal <sig>` and `without an exit status` read as before.

On your four questions: we took the diagnostic-only shape (no split of direct result from range quiescence), the inline `; runner stderr: <tail>` suffix rather than a structured field, no status-code classification (only the decimal + hex you suggested, which makes `0xC0000409`-style statuses readable), and tail-only capture with no head.

Validation: the package suite passes (15 files / 393 tests, 13 platform-skipped) with 100% statement, branch, function, and line coverage of the two changed files; the new and updated cases fail against `master`'s sources; host typecheck, lint, and the documentation gates pass. `pnpm run doc-sync` reports 2 failures, both pre-existing in the repository and unrelated to this diff (the tool catalog is missing `tool-working-directory`, and an upgrade guide still links the removed `packages/experimental/ptc-runtime-python`).

One honesty note on the evidence: we cannot inject a real Windows crash (`0xC0000409`) from our Linux checkout, so the new tests drive a fake child process — the message text, the 4 KiB truncation, and the fd layout are covered, while your error-ledger comparison remains the end-to-end evidence for the real crash path.

Upstream does not accept external pull requests, so the branch sits on the fork.

# 中文对照（仅供阅读，不发布）

我们对照当前 `master`（`4b399c39a6`）核对了这个诊断缺口：`runner-launch.ts` 的 `runnerStdio()` 把 runner 自身 fd 2 设为忽略，因此在能证明受管范围已空之前被杀或崩溃的 runner 只会在 `SUBPROCESS_RUNNER_FAILED` 消息里留下一个裸十进制退出码，Node 致命错误或模块加载失败的文本被丢弃。

我们的分支是 `fix/subprocess-runner-stderr-diagnostic`（`3dc25892948fd2bf629d7eed22fa9d6e7b46de22`），依据你的报告写成，没有取用你的对比分支——没有 cherry-pick `Ruiyi-Zhang-BUPT:fix/subprocess-runner-stderr-diagnostic`。

实现与你的建议一致：

- `runnerStdio()` 把 runner 的 fd 2 改为管道；fd 0/1 仍忽略，fd 3 仍为 IPC，fd 4–6 承载 target stdio，fd 7 仍是控制通道。
- `windows-job.ts` 保留该流最后 4 KiB。截断只会切掉 lead byte，因此无效序列只可能出现在尾部开头；解码成替换字符后被丢弃，再 trim。空尾部时消息与旧版逐字节一致。
- 两条 `SUBPROCESS_RUNNER_FAILED` 消息（范围结算一条与启动后失败一条）在有捕获时追加 `; runner stderr: <尾部>`，退出码同时输出无符号 32 位十进制与十六进制（`exit code 3221226505 (0xC0000409)`）。fail-closed 条件与 result 结算语义不变；`signal <sig>` 与 `without an exit status` 的文本不变。

关于你的四个问题：我们采用诊断-only 的形状（不拆分 direct result 与 range quiescence）、内联 `; runner stderr: <tail>` 而非结构化字段、不做状态码分类（只补你提到的十进制+十六进制，使 `0xC0000409` 这类状态码可读），以及只保留尾部不保留头部。

验证：包内测试全绿（15 个文件 / 393 个测试、13 个平台相关跳过），两个改动文件的语句、分支、函数、行覆盖率均为 100%；新增与更新的用例在 `master` 的源码下失败；host typecheck、lint 与文档门禁通过。`pnpm run doc-sync` 有 2 个失败，都是仓库既有问题，与本次改动无关（工具目录缺少 `tool-working-directory`，以及一份升级指南仍链接已删除的 `packages/experimental/ptc-runtime-python`）。

如实说明一点证据局限：我们的 Linux 检出无法注入真实的 Windows 崩溃（`0xC0000409`），因此新测试用假子进程驱动——消息文本、4 KiB 截断与 fd 布局都已覆盖，真实崩溃路径的端到端证据仍需你的账本事后对照。

上游不接受外部 PR，因此该分支暂存在 fork 上。
