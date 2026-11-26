## Motivation

在 Desktop 客户端仅点击打开、浏览历史会话（只读回看记录，未发送新消息）时，客户端会通过两条路径把 prepared 会话唤醒为常驻活体 Agent：客户端传输层在 `session/follow` 请求里写死 `activate: true`，尽管 wire 契约注释明确「Request background activation; omission leaves the read passive」，且仓库 README 已声明「日志跟随可以在不激活 Agent 的情况下检查 persistence」；同时输入框挂载时的 slash 命令预热经 `commands.list` 的 Typert Agent lookup 间接恢复同一会话的 Agent。浏览多条历史会话后，后台活体 Agent 与渲染负载持续累积。Refs #14351

## Changes

**Interface changes**: None（wire 契约不变：`activate` 本就是可选字段，省略即文档声明的被动读取；服务端 `session/follow` 的激活契约保持原样，host 侧规格继续固定 `activate: true` 的提升语义）。

**Behavior changes**:
- 客户端打开或浏览会话不再激活任何东西：`SessionEventStream` 的 follow 请求省略 `activate`，服务端不再把 prepared 会话提升为活体 Agent；活跃会话的实时事件、Assistant 流、重连修复路径不受影响。会话激活收敛到真正的参与路径——`prompt`、queue 变更、commands 执行等 RPC 各自经 `resolveAgent` 解析或恢复 Agent，与 follow 无关（这也是 README 第 40 行已声明的各端点激活策略）。
- slash 命令目录的挂载预热（scope-birth warm hook）只在会话 Agent 已经 running 时拉取目录；冷会话不再经预热路径唤醒 Agent，目录在首次使用（输入 `/` 触发 `candidates()` → `ensureReady`）时拉取。代价是冷会话首次打开斜杠菜单多一次 `commands.list` RPC 往返；正确性不变（`ensureReady` 本就是强等待路径，冷拉取与预热走同一条 `refresh`）。
- 8 处既有客户端测试的请求形状期望随行为一并更新（tests describe behavior）：3 个 spec 的 follow 请求期望不再含 `activate: true`，ui-commands 的 warm hook 用例改为固定「冷会话跳过、running 会话预热、pending 不重复拉取」。

**Module responsibilities and dependencies**: None（改动落在 `dsh-api-session-controller` 的客户端传输与其规格、`dsh-client-ui-commands` 的 warm hook 与其规格；无新增或删除的包间运行时依赖，无职责移动）。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 打开/浏览 prepared 会话 | follow 携带 `activate: true`，host 提升为活体 Agent | follow 省略 `activate`，host 保持 prepared（host 侧既有规格 `transport.host.spec.ts` "does not activate a prepared Session when the request omits activate" 固定该契约） | `transport.client.spec.ts` 等三个 spec 的请求形状期望（省略 `activate`） |
| 斜杠命令 warm hook：冷会话（Agent 未运行） | 挂载即拉取 `commands.list`，经 Typert lookup 恢复 Agent | 跳过拉取，目录留待首次使用 | `service.client.spec.ts` warm 用例（`listCalls` 为空） |
| 斜杠命令 warm hook：running 会话 | 挂载即拉取（Agent 已活，无恢复成本） | 同样预热 | 同上（`listCalls` 恰一次，pending 不重复） |
| 冷目录首次使用 | 预热已就绪 | `candidates()` → `ensureReady` 即时拉取 | 既有 candidates 用例不变通过 |

负控：把两个源文件还原到 pre-fix 后重跑，6 个用例失败（5 个 transport 请求形状期望观察到 `activate: true` 残留、1 个 warm 门用例观察到冷会话被拉取），确认用例覆盖该回归。

**范围说明**：本机为 Linux；激活行为由传输层请求形状测试与服务端既有 host 规格共同覆盖，未嵌入演示 GIF——本改动没有渲染输出或界面文案变化，可见效果仅体现为 Host 的 Agent 生命周期（浏览后不再出现常驻 Agent），录屏需双端对照展示且当前工具链无法按 GUI PR 要求附加。reconnect 后 `resetConnected`/`invalidateAll` 对目录中已有 key 的重拉、以及用户真实输入 `/` 时 `commands.list` 对冷 Agent 的恢复保持原语义（那是参与行为，且目录 key 在改动后只存在于已参与或 running 会话）。

**Test entries**:
- `pnpm exec vitest run packages/api/session-controller/tests/transport.client.spec.ts packages/api/session-controller/tests/session.client.spec.ts packages/api/session-controller/tests/manager.client.spec.ts --maxWorkers=2` — 3 个文件、423 个用例通过（本机）。
- `pnpm exec vitest run packages/client/ui-commands/tests/service.client.spec.ts --maxWorkers=2` — 71 个用例通过（本机）。
- `pnpm run test:gui` — 834 个文件、14763 个用例通过、2 个跳过（本机）。
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
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据报告核对两条唤醒路径的代码（transport 写死 activate、warm hook 经 Typert lookup 恢复）并确认发送路径独立激活。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择让 follow 省略 `activate` 以符合 wire 契约与 README 已声明的端点激活策略，并让 warm hook 以会话 running 状态作预热门槛。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 更新请求形状期望与 warm 用例，并以负控验证 6 个用例覆盖该回归。 |
| implementation 技术实现 | auto 模型自主 | 100% | 传输层、warm hook、4 个测试文件由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
