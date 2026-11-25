<!--
状态：草稿，未发布。
用途：Discussion #14253 的回复正文，供作者过目后决定是否发布。
目标渠道：上游仓库的 Discussions（上游 CONTRIBUTING 声明不接受外部 PR、Issues 已关闭，Discussions 是唯一被认可的反馈渠道）。
说明：本仓库是 fork，改动在分支 `fix/web-app-clean-startup-url` 上，未向上游开 PR。
-->

# English reply (for posting to Discussion #14253)

Thank you for the report — the chain checks out, and I can confirm where the exposure was.

**What I found on `master`**

`dsh web` printed one line, `dsh web: http://127.0.0.1:<port>/?token=…`. The launch token was on the address itself: the token plugin contributed the signed address through `webserver/entry-url`, and WebApp printed `entry.url` verbatim. That printed address was the only place the token reached a process-readable surface — `DSH_WEB_URL` and the address in the agent's runtime context were already the clean root, and the default-browser handoff never used the process output. So an agent that can read the startup output (a service log, a redirected file, a captured pane, or the output of its own shell command) could redeem that token for an owner browser session through `authorizeIndex`, and the agent-controlled page could then answer the harness's own approval prompts. That is the boundary break you describe, and I agree with the severity.

**Proposed fix**

Separate the address that is published from the address that is handed to the browser:

- `WebEntryUrl` (in `dsh-host-webserver`) gains an optional `openUrl`: the handoff address, used when it differs from the published one. `WebEntryUrl.url` becomes the credential-free published address.
- The token plugin contributes `{ url: baseUrl, openUrl: authenticatedUrl(baseUrl) }`, so the token exists only on the handoff address.
- WebApp prints the published address only. The one-time login link — the only address that carries the token — is printed on its own line, and only when the process output is an interactive terminal or when the deployment asks for it explicitly (`--print-login-url`, `Config.printLoginUrl`). Redirected output prints a note that it carries no login link, so a token is not silently written into a service log.
- The default-browser handoff is unchanged in behaviour: it still opens the signed address, out of band, outside the process output.
- The human sign-in path stays intact: on an interactive terminal the operator opens the printed login link and completes one sign-in exchange; the GUI's owner-only "copy one-time link" entry reads the signed address from `openUrl`; the anonymous login page still accepts a pasted link.
- The 401 body now points at the one-time login link from the startup output instead of at the printed URL.

Regression test: `keeps the launch token out of redirected startup output` asserts that redirected startup output contains the plain address and does not contain the tokenized address; the SSH case and the "no browser" case assert the same. The coverage for the four touched packages stays at 100% per file.

**Scope question for the maintainers**

This change removes the token from every agent-readable surface, which closes the reported chain. Two of the other suggestions in the report are broader design questions that I would rather not decide unilaterally:

- isolating the owner browser profile in browser-use attach mode, so an agent-driven browser is never the owner browser;
- binding an approval to an independent human subject rather than to a browser session.

I would be glad to take either on, but they touch the connection/authentication design rather than the startup output. Which direction do you want first?

A branch with the change is on my fork (`fix/web-app-clean-startup-url`, based on `dsh-v0.2.3-alpha.2`). I have not opened a pull request, since `CONTRIBUTING.md` states that external pull requests are not accepted — happy to hand over the branch, a patch, or a diff in whatever form is useful to you.

# 中文对照（仅供作者阅读，不发布）

感谢报告——攻击链成立，我确认了暴露点。

**在 `master` 上的核对结果**

`dsh web` 打印一行 `dsh web: http://127.0.0.1:<port>/?token=…`，令牌就在地址上：令牌插件把带令牌的地址通过 `webserver/entry-url` 贡献出来，WebApp 原样打印 `entry.url`。那一行是令牌唯一进入「进程可读面」的地方——`DSH_WEB_URL` 与 agent 运行时上下文里给的都是干净根地址，默认浏览器交接也从不经过进程输出。因此能读到启动输出的 agent（服务日志、重定向文件、被捕获的面板，或它自己 shell 命令的输出）都能用这个令牌经 `authorizeIndex` 换一个 owner 浏览器会话，agent 控制的页面随后就能回答 harness 自己的审批请求。这正是报告描述的边界破坏，我认同其严重性。

**修复方案**

把「对外发布的地址」与「交给浏览器的地址」分开：

- `WebEntryUrl`（`dsh-host-webserver`）新增可选字段 `openUrl`：交接地址，与发布地址不同时才出现；`url` 收紧为不含凭据的发布地址。
- 令牌插件贡献 `{ url: baseUrl, openUrl: authenticatedUrl(baseUrl) }`，令牌只存在于交接地址。
- WebApp 只打印发布地址。一次性登录链接（唯一带令牌的地址）单独成行，且只在进程输出是交互式终端、或部署显式要求时打印（`--print-login-url` / `Config.printLoginUrl`）。输出被重定向时打印一行说明「不含一次性登录链接」，避免令牌被悄悄写进服务日志。
- 默认浏览器交接行为不变：仍打开带令牌的地址，out-of-band，不经进程输出。
- 人类登录路径保持可用：交互终端下操作者点开打印出的登录链接完成一次 sign-in 交换；GUI 的 owner 独占「复制一次性链接」入口从 `openUrl` 取地址；匿名登录页仍接受粘贴的链接。
- 401 文案改为指向启动输出中的一次性登录链接。

回归测试：`keeps the launch token out of redirected startup output` 断言重定向的启动输出含干净地址、不含带令牌的地址；SSH 场景与不打开浏览器的场景同样断言。四个受影响包的逐文件覆盖率仍为 100%。

**留给维护者的范围问题**

本改动把令牌从所有 agent 可读面上移除，报告中的链路因此闭合。报告里的另外两条建议属于更大的设计问题，我不愿单方面决定：

- 在 browser-use attach 模式下隔离 owner 浏览器 profile，使 agent 驱动的浏览器永远不是 owner 浏览器；
- 把审批绑定到独立的人类主体，而不是绑定到一个浏览器会话。

这两条触及连接/认证设计而非启动输出，我愿意接手，但需要先确认优先级。

改动在 fork 的分支 `fix/web-app-clean-startup-url`（基于 `dsh-v0.2.3-alpha.2`）上。由于 `CONTRIBUTING.md` 声明不接受外部 PR，我没有开 PR——需要的话我可以以分支、patch 或 diff 的形式交付。
