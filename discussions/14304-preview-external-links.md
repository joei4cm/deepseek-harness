<!--
状态：草稿，未发布。
用途：Discussion #14304 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/preview-external-links` 分支，未向上游开 PR。
-->

# English reply (for posting to Discussion #14304)

Thank you for the thorough report and verified design. I implemented the same architecture on a fork branch and verified it with focused tests: an in-frame capture-phase click bridge that forwards a trusted HTTP(S) link to the parent, a parent gate that accepts only messages from the preview frame itself and opens a bounded number of links, and a Desktop main-process guard that refuses a preview frame's navigation to an external site.

Two choices differ slightly from the proposal, in the same spirit:

- The Desktop guard identifies the preview frame by its Blob URL (`frame.url` starts with `blob:`) rather than its name. A frame holding untrusted file content is addressed by an opaque Blob URL, and this rule needs no shared frame-name constant between the client and the shell; the result is the same denial the proposal described.
- The shared URL policy lives in one `openableExternalUrl` module used by the window open handler, the main-frame navigation handler, and the Sidebar webview guests, so all three reject malformed URLs, credential-bearing URLs, and the application's own Host port or loopback names.

The client bridge leaves `#fragment` links, relative links, and non-HTTP(S) schemes inside the frame, and ignores untrusted clicks. The parent accepts at most five requests in five seconds and opens a repeated link once, matching the proposed limits. Focused unit and component tests cover the bridge, the parent gate, the URL policy, and the Desktop navigation guards, and the package test suites pass locally. A real Desktop application demonstration remains outstanding.

# 中文对照（仅供作者阅读，不发布）

感谢详尽的报告和已验证的设计。我在 fork 分支上实现了相同的架构并通过了专项测试：框架内的捕获阶段点击桥接把可信的 HTTP(S) 链接转发给父页面；父页面的闸门只接受来自预览框架自身的消息并有界地打开链接；Desktop 主进程拒绝预览框架导航到外部站点。

有两处与方案略有不同，但意图一致：

- Desktop 守卫以框架的 Blob URL（`frame.url` 以 `blob:` 开头）识别预览框架，而不是按名称。承载不可信文件内容的框架由不透明 Blob URL 标识，这样客户端与外壳之间无需共享框架名常量；结果是方案中描述的同一拒绝行为。
- 统一的 URL 策略集中在一个 `openableExternalUrl` 模块中，供窗口打开处理器、主框架导航处理器和侧边栏 webview 访客共用，三者都拒绝无法解析的 URL、带凭据的 URL，以及指向应用自身 Host 端口或回环名称的 URL。

客户端桥接把 `#` 片段链接、相对链接和非 HTTP(S) scheme 留在框架内，并忽略非可信点击。父页面五秒内最多接受五个请求，同一链接的重复请求只打开一次，与方案中的限制一致。专项单元与组件测试覆盖桥接、父闸门、URL 策略和 Desktop 导航守卫，相关包的测试在本地通过。真实 Desktop 应用演示仍待完成。
