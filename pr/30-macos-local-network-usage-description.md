## Motivation

macOS 15 及更高版本会拦截未声明 `NSLocalNetworkUsageDescription` 的应用对局域网的访问：连接直接报 `EHOSTUNREACH`，系统也不会弹出本地网络授权、应用不会出现在「系统设置 → 隐私与安全性 → 本地网络」列表里，用户无从授权。打包产物只声明了 `NSMicrophoneUsageDescription`，因此桌面端宿主、其加载的插件以及由其拉起的 stdio MCP 子进程都无法访问局域网设备，而同一请求在终端里正常。Refs #14378

## Changes

**Interface changes**: None（无 wire 格式、配置键或持久化格式变化；新增的是 macOS 应用包 Info.plist 的一个键）。

**Behavior changes**:
- macOS 打包产物声明 `NSLocalNetworkUsageDescription`：首次访问局域网时系统弹出本地网络授权，用户可以在「系统设置 → 隐私与安全性 → 本地网络」中查看和管理。
- 宿主、插件和由其启动的 stdio MCP 子进程对局域网设备的访问不再因缺少声明而报 `EHOSTUNREACH`。这些进程与主应用同属一个 bundle（插件宿主以 `ELECTRON_RUN_AS_NODE=1` 运行 Electron 本体，MCP 子进程由宿主拉起），由同一份 Info.plist 覆盖。
- 桌面 README（英/中双语）在麦克风权限说明旁写明该声明及其覆盖范围。

**Module responsibilities and dependencies**: None（改动落在 `dsh-desktop` 应用的打包配置、类型声明与测试，无新增或删除的包间运行时依赖）。

## Testing

**Test design**（配置声明，行为矩阵不适用）：

| 项 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| macOS `extendInfo` | 无 `NSLocalNetworkUsageDescription` | 声明该键及用途说明 | `macos-signature.spec.ts` 新增断言 `expect(config.mac.extendInfo.NSLocalNetworkUsageDescription).toContain('local network')` |

负控：还原 `apps/desktop/scripts/electron-builder-config.mjs` 后，该断言失败（键为 `undefined`），确认用例覆盖该回归。

**环境限制**：本机为 Linux，无法构建或运行 macOS 应用；验证止于打包配置、其类型声明与测试。系统授权弹窗与局域网连通需要在 macOS 上用打包产物复验。

**Test entries**:
- `pnpm exec vitest run apps/desktop/tests/macos-signature.spec.ts apps/desktop/tests/macos-disk-image-signature.spec.ts apps/desktop/tests/installer-packaging.spec.ts --maxWorkers=2` — 3 个文件、27 个用例通过（本机）。
- `pnpm run typecheck` — 通过（本机）。
- `pnpm run lint` — 通过（本机）。
- `pnpm run doc-sync` — 43 个 gate 全过（本机）。
- 推送时的 pre-push typecheck — 通过（本机）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据报告与上游相关讨论定位到 macOS 本地网络隐私要求缺少 `NSLocalNetworkUsageDescription` 声明。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择在打包配置的 `extendInfo` 中声明该键，并确认宿主与 MCP 子进程由同一 bundle 覆盖。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 在既有发布签名配置测试中补充断言，并以负控验证用例覆盖该回归。 |
| implementation 技术实现 | auto 模型自主 | 100% | 配置、类型声明、测试与 README 双语改动由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
