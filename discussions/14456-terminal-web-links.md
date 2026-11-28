<!--
Status: draft, not published.
Target: Discussion #14456.
Do not publish without explicit user authorization and a fresh check for new comments.
-->

# English reply (draft)

Thanks for the report — the root-cause work is exactly right: the sidebar terminal loads only `FitAddon`, and xterm's official `@xterm/addon-web-links` is the missing piece. We took it on against current `master` (`4b399c39a6`).

Our branch is `feat/terminal-web-links` (`ba0fe13bd7521c713a96652793b3d7616cf72f68`), written from your report.

What it does:

- The terminal screen loads `WebLinksAddon` next to `FitAddon`, inside the same lazy `client.terminal.js` chunk, so nothing new reaches the startup bundle. Printed http/https addresses become clickable: hovering shows the link state (the screen's cursor turns into the link pointer and the address underlines), and activating one opens it in a browser — a new tab on Web, and the system browser on Desktop, which already routes every `window.open` through its window handler to `shell.openExternal`.
- The handler opens the resolved URL in one `window.open(uri, '_blank', 'noopener,noreferrer')` request, the same call shape the chat's external links use. This is required on Desktop, not cosmetic: the Desktop window handler denies every popup and forwards only http/https URLs to the system browser, so the addon's default flow (open a blank popup first, then navigate it) would be denied before it could navigate.
- The protocol whitelist also lives in our handler: only `http://` and `https://` pass; everything else — including `file:` — stays plain text. Terminal output is untrusted text, so we did not want the boundary to rely on the addon's default regex alone.
- We followed your primary recommendation and kept plain click as the default, with no modifier key and no new setting. We also did not carry the chat's "open in the sidebar browser" preference into the terminal: terminal URLs are typically local server addresses whose normal destination is a real browser, and the preference stays chat-scoped.

Validation: the package suite reaches 100% statement, branch, function, and line coverage with new cases for the protocol matrix and the exact `window.open` shape (a master-sources control run fails the new case). The real-app check runs the shipped sidebar-terminal e2e over the real Loader, mux, Chromium, and a local PTY: the new case prints both addresses through a real shell, hovers the link (pointer-cursor state), clicks, and asserts a browser context opens at exactly that URL; clicking the `file:///etc/hosts` line opens nothing; the hover screenshot was inspected by eye — the URL underlines, the `file:` line stays plain. The file's other eleven scenarios pass unchanged, and the existing goldens replay unchanged. Host typecheck, lint, build, the GUI lane, and the documentation gates pass; one unrelated hygiene gate (`vendor rescope`) fails identically on a pristine `master` checkout in this environment and is unrelated to the diff.

Upstream does not accept external pull requests, so the branch sits on the fork.

# 中文对照（仅供阅读，不发布）

感谢这份报告——根因定位完全正确：侧栏终端只加载了 `FitAddon`，缺的正是 xterm 官方的 `@xterm/addon-web-links`。我们对照当前 `master`（`4b399c39a6`）接手了这个问题。

我们的分支是 `feat/terminal-web-links`（`ba0fe13bd7521c713a96652793b3d7616cf72f68`），依据你的报告写成。

它做的事：

- 终端屏幕在 `FitAddon` 旁加载 `WebLinksAddon`，仍在同一个懒加载 `client.terminal.js` chunk 里，启动 bundle 不新增任何内容。输出中打印的 http/https 地址变为可点击：悬停显示链接态（屏幕光标变为链接指针、地址出现下划线），点击后在浏览器中打开——Web 是新标签页；Desktop 经既有窗口 handler 把 `window.open` 路由到 `shell.openExternal`，即系统浏览器。
- handler 用一次 `window.open(uri, '_blank', 'noopener,noreferrer')` 打开最终 URL，与聊天区外链同一调用形态。这在 Desktop 上是必需的而不只是风格：Desktop 的窗口 handler 拒绝所有弹窗、只把 http/https URL 转交系统浏览器，所以 addon 默认「先开空白弹窗再导航」的流程会在导航前就被拒绝。
- 协议白名单也放在我们自己的 handler 里：只有 `http://` 和 `https://` 放行，其余（包括 `file:`）保持纯文本。终端输出是不可信文本，这个边界不该只依赖 addon 的默认正则。
- 采用你建议的首选方案：默认直接点击打开，不加修饰键，也不新增设置项。聊天区的「在侧栏浏览器打开」偏好没有带进终端：终端 URL 通常是本地服务地址，常规去向就是真正的浏览器，该偏好仍属于聊天域。

验证：包内测试达到语句、分支、函数、行 100% 覆盖，新增用例覆盖协议矩阵与确切的 `window.open` 调用形态（master 源码对照运行下新用例失败）。真实应用验证跑的是随仓的 sidebar-terminal e2e（真实 Loader、mux、Chromium 与本地 PTY）：新用例用真实 shell 打印两个地址，悬停链接（指针光标态）后点击，断言打开的浏览器上下文 URL 精确匹配；点击 `file:///etc/hosts` 行没有任何新页面；悬停截图经人工目检——URL 有下划线，`file:` 行保持纯文本。该文件其余 11 个场景全部通过，既有 golden 快照回放未变。host typecheck、lint、build、GUI 车道与文档门禁通过；一个无关的 hygiene 门禁（`vendor rescope`）在本环境的干净 master 检出上同样失败，与本次改动无关。

上游不接受外部 PR，因此该分支暂存在 fork 上。
