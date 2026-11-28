<!--
Status: draft, not published.
Target: Discussion #14447.
Do not publish without explicit user authorization and a fresh check for new comments.
-->

# English reply (draft)

Thanks for the report — we took this on against current `master` (`4b399c39a6`).

Our branch is `feat/subagent-codex-config-bin` (`623f316bf356da5b0711558eb2a758062c568cd0`), and it implements exactly the shape you proposed: a new optional `codexBin` config field on `subagent-codex` that starts the executable directly as `<codexBin> app-server --stdio`, with the bundled 0.153.4 payload unchanged as the default when it is omitted.

What it does:

- `codexBin` accepts an absolute path to a Codex executable — for example a native binary from a newer `@openai/codex` installed elsewhere. It runs as argv[0] directly, so npm global installs (which are symlinks) work too.
- Validation fails loud at plugin load, not at the first delegation: the path must be absolute, must not be a `.cmd`/`.bat` batch shim (Windows refuses to spawn those without a shell), and must name an existing executable file. The error message carries the configured path.
- Everything else is untouched: the runtime dependency stays pinned to `0.153.4`, there is no `PATH` lookup or environment-variable form, and no automatic host-CLI fallback — only the explicit `codexBin` runs another executable. The wire layer still validates handshake, thread, and turn responses and fails the run on unknown server requests, so a genuinely incompatible executable surfaces as a safe run failure rather than a silent misbehavior.
- We did not take the `env`/fallback variants from the thread on #9949: a config field is the one route that is visible in `cordis.yml`, validated at load, and per-Provider-instance (two mounted instances can run different Codex versions side by side).

Validation: the package suite reaches 100% statement, branch, function, and line coverage with new cases for the argv shape, the load-time rejection matrix, and the config schema; the real-product lane runs the full delegation through the real app-server with a configured executable and asserts the spawned argv and the returned answer; a master-sources control run fails exactly the new cases. One-off, we also pointed the same real test at the native vendor binary shipped in this repo's install — the full protocol round trip passed.

Upstream does not accept external pull requests, so the branch sits on the fork.

# 中文对照（仅供阅读，不发布）

感谢这份报告——我们对照当前 `master`（`4b399c39a6`）接手了这个问题。

我们的分支是 `feat/subagent-codex-config-bin`（`623f316bf356da5b0711558eb2a758062c568cd0`），实现的正是你提议的形态：`subagent-codex` 新增可选 `codexBin` 配置字段，以 `<codexBin> app-server --stdio` 直接启动该可执行文件；未设置时缺省行为仍是随包的 0.153.4 载荷，逐字节不变。

它做的事：

- `codexBin` 接受 Codex 可执行文件的绝对路径——例如安装在别处的更新版 `@openai/codex` 的原生二进制。它直接作为 argv[0] 运行，npm 全局安装（符号链接）也可用。
- 校验在插件加载期大声失败，而不是等到第一次委派：路径必须绝对、不得是 `.cmd`/`.bat` 批处理 shim（Windows 无 shell 时拒绝 spawn）、必须指向已存在的可执行文件；错误消息携带所配置的路径。
- 其余行为不动：运行时依赖仍精确锁定 `0.153.4`，不做 `PATH` 查找或环境变量形态，也没有自动宿主 CLI 回退——只有显式 `codexBin` 会运行其他可执行文件。wire 层仍校验握手、线程与轮次响应，并在未知服务端请求上使运行失败，因此真正不兼容的可执行文件表现为安全的运行失败而非静默异常。
- 我们没有采纳 #9949 讨论中的 env／回退变体：config 字段是唯一同时满足「在 `cordis.yml` 中可见、加载期校验、按 Provider 实例生效」的路线（两个挂载实例可以并排运行不同 Codex 版本）。

验证：包内测试达到语句、分支、函数、行 100% 覆盖，新增用例覆盖 argv 形态、加载期拒绝矩阵与 config schema；真实产品车道以配置的可执行文件走完整委派，断言 spawn argv 与返回答案；master 源码对照运行下恰好新用例失败。另做过一次性验证：把同一真实用例指向本仓安装的原生 vendor 二进制，完整协议往返通过。

上游不接受外部 PR，因此该分支暂存在 fork 上。
