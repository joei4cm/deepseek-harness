<!--
状态：草稿，未发布。
用途：Discussion #14378 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/macos-local-network-usage-description` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）；打包配置在当前代码树中逐条核对过。
-->

# English reply (for posting to Discussion #14378)

Your diagnosis matches the current tree. Since macOS 15, an app that does not declare `NSLocalNetworkUsageDescription` is blocked from the local network: the connection fails with `EHOSTUNREACH`, the system never shows the local-network prompt, and the app never appears in System Settings → Privacy & Security → Local Network, so there is no way for the user to grant it. The packaged Desktop bundle declares `NSMicrophoneUsageDescription` but not this key, which is why your plugin host and the stdio MCP servers it starts cannot reach LAN devices while the same request succeeds from a terminal.

I added the declaration on a fork branch (`fix/macos-local-network-usage-description`, based on upstream `master`):

1. **The macOS bundle declares `NSLocalNetworkUsageDescription`** in the electron-builder `extendInfo`, next to the existing microphone description. The host, the plugins it loads, and the stdio MCP servers they start are all covered by that one key: the plugin host runs the Electron binary itself with `ELECTRON_RUN_AS_NODE=1`, and the MCP servers are children of that host, so they share the app's bundle identity and its Info.plist.
2. **The release-signature configuration test pins the key**, and the desktop README documents it beside the microphone permission.

Two notes on scope. The development app bundle (`Harness Dev.app`) copies Electron's own Info.plist and declares no usage descriptions at all — the microphone key is absent there too — so I left it unchanged rather than introduce a development-only divergence. And I could not verify the actual system prompt or LAN connectivity from here: this machine is Linux, so the change is covered by the packaging configuration and its test, and the end-to-end check needs a macOS build of the packaged app.

The branch and a full pull-request description are ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

# 中文对照（仅供作者阅读，不发布）

你的定位与当前代码树一致。macOS 15 起，未声明 `NSLocalNetworkUsageDescription` 的应用会被拦截局域网访问：连接直接报 `EHOSTUNREACH`，系统不会弹出本地网络授权，应用也不会出现在「系统设置 → 隐私与安全性 → 本地网络」列表里，用户无从授权。打包产物只声明了 `NSMicrophoneUsageDescription`，没有这个键——这正是你的插件宿主和由其拉起的 stdio MCP 子进程无法访问局域网设备、而同一请求在终端里正常的原因。

我在 fork 分支（`fix/macos-local-network-usage-description`，基于上游 `master`）上补上了这个声明：

1. **macOS 应用包在 electron-builder 的 `extendInfo` 中声明 `NSLocalNetworkUsageDescription`**，与现有的麦克风用途说明并列。宿主、其加载的插件以及由其拉起的 stdio MCP 子进程都由这一个键覆盖：插件宿主以 `ELECTRON_RUN_AS_NODE=1` 运行的就是 Electron 本体，MCP 子进程是该宿主的子进程，因此三者共享应用的 bundle 标识与同一份 Info.plist。
2. **发布签名配置测试固定了该键**，桌面 README 也在麦克风权限说明旁写明了它。

两点范围说明。开发用的 `Harness Dev.app` 复制的是 Electron 自带的 Info.plist，本来就不声明任何用途说明（麦克风键同样没有），因此我没有改动它，避免引入仅开发环境才有的分歧。另外，这里无法验证真实的系统授权弹窗与局域网连通：本机是 Linux，改动由打包配置及其测试覆盖，端到端验证需要用打包后的 macOS 应用复验。

分支与完整的 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。
