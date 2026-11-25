## Motivation

桌面端 welcome 客户端在 0.2.1→0.2.2 间从 Chromium `net.fetch` 换到 Node `fetch`（undici）时失去了前者对传输层失败的自动重试：启动握手阶段 `settings/describe` 的一次瞬时环回重置（`TypeError: fetch failed` / `read ECONNRESET`）会沿 `reconcileBackend` 上报为致命崩溃。Refs #14308

## Changes

**Interface changes**: None。

**Behavior changes**:
- `connectDesktopWelcome` 内新增 `invokeRead`：只读 RPC 在传输层以 `TypeError` 拒绝时，等待 250 ms 后重试一次。白名单：`settings/describe`、`llm/listConfigurableProviders`、`credentials/describe`、`account/getState`、`productAnalytics/enabled`——这些是 `read()`/`readLocalePreference()`/`analyticsEnabled()`/`account.state()` 的启动只读路径。
- HTTP 错误响应不重试（服务端已给出结果）；中止/超时不是 `TypeError`，直接传播；`credentials/set` 与登录生命周期保持单次调用——结果未知的写操作绝不重发。`productAnalytics/report` 本身 fire-and-forget，不重试。
- 每次尝试使用新的 `rpcId`；调用方 `AbortSignal` 同时约束第二次尝试与等待。

**Module responsibilities and dependencies**: None（`apps/desktop` 内部改动，无包边变化）。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 只读方法遇 `TypeError: fetch failed` | 直接失败 → 启动致命 | 等 250 ms 重试一次并成功（新 rpcId） | `readLocalePreference`、`account.state` 两个用例 |
| 同样失败后第二次仍失败 | — | 第二次错误原样传播，恰好两次调用 | `propagates the second transport failure` |
| 写/analytics 调用遇同错 | 单次失败 | 仍单次（不重试） | `does not retry a mutating or analytics call` |
| 调用方 deadline 中止 | — | `TimeoutError` 非 TypeError，直接传播、不重试 | `propagates a caller deadline` |

端到端的启动竞态无法在本机（Linux、非 Electron 打包形态）复现；`connectDesktopWelcome` 的 `send` 注入点使传输失败可在注入层确定性模拟。Windows Electron 行为由 CI 覆盖。

**Test entries**:
- `pnpm exec vitest run apps/desktop/tests/welcome-backend.spec.ts` — 新增 spec，5 用例通过（本机）。
- 推送时 pre-push typecheck：5 gates 全过（本机，~33s）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 在源码定位重试缺失；Linux 对照实验未能复现共享连接机制，故只做防御性重试而非机理断言。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选 white-list 只读重试而非全局重试或序列化，避免写操作重发。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计注入层失败矩阵并运行。 |
| implementation 技术实现 | auto 模型自主 | 100% | 代码与 spec 由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
