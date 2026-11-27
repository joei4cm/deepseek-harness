## Motivation

归档会话不释放它保留的 persistent PTC 运行时环境：归档只写入归档集合并派发 `workspace/session-archived`，而 `dsh-tool-executor-ptc` 唯一挂出的自动释放点是 Agent 上的 `agent.ctx.effect(() => () => runtime.release(agent))`——只有 Agent 卸载时才释放。归档不卸载 Agent，于是每个跑过工具的会话都留下一个常驻 Node 进程（报告者连续运行 5 天累积 44 个、约 3G 压缩内存），而这些进程对用户不可见。Refs #14401

## Changes

**Interface changes**: None。

**Behavior changes**:

- 保留状态的 PTC 环境现在有两个释放时机：Agent 卸载（既有行为），以及会话归档（新增）。归档时，Agent 作用域内的监听器先取消该会话正在运行的程序，再结束该 Agent 保留的每个环境。
- 归档释放不排入模型可见通知：被归档的会话已被隐藏，没有观察者；取消归档也不会恢复环境，下一个程序从空内存开始。
- 释放失败会写入宿主日志，归档不回滚；该会话的程序保持阻塞，直到后续一次释放成功（沿用 `PtcCalls.reset` 的既有语义）。
- 没有挂载 Workspace 注册表的组合行为不变：环境保留到 Agent 卸载。
- `packages/core/tool-executor-ptc/README.md` 与 `README.zh.md` 增加归档释放的机制说明与文件清单条目；「状态由运行时决定」一条补充归档会结束保留环境。`packages/ptc-runtime/ptc-runtime-node/README.md` 与 `README.zh.md` 的保留内存清除清单补入「归档会话」。归档事件多出一条消费者边，`docs/event-producer-consumer.md` 与中文对照重新生成。

**Module responsibilities and dependencies**:

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-tool-executor-ptc` | `ctx.tools` 的 PTC 执行器：程序传输、工具绑定、生成的 SDK 提示、宿主环境重置 | 改为在会话归档时释放该 Agent 保留的运行时环境 |
| `dsh-workspace` | 持久化的工作区注册表：工作区实体、会话归档集合 | 不变，被 PTC 执行器读取归档事件 |

依赖边：

- 新增 `dsh-tool-executor-ptc → dsh-workspace`（可选 peer）
- 反向边：无。`dsh-workspace` 的运行时依赖是 `dsh-brand`、`dsh-session`、`dsh-session-persistence`、`dsh-storage`、`dsh-storage-domain` 与 `dsh-typert-protocol`，不含 `dsh-tool-executor-ptc`。

调用流程：

```ts
// 归档：注册表写入归档集合后派发事件
await this.ctx.parallel('workspace/session-archived', { sessionId })
// PTC 执行器：Agent 作用域内的监听器只处理自己的会话
if (sessionId !== agent.session.id) return
// 取消该会话在跑的程序，等待结算后结束保留的环境
await calls.reset(sessionId, () => provider.release(agent))
```

## Testing

**Test design**:

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 归档一个跑过程序的会话 | 保留的环境不释放，运行时进程存活 | 环境被释放，释放者是该会话的 Agent | 新增 `archive-release.spec.ts` 第一条用例 |
| 归档一个正在跑程序的会话 | 程序继续运行到自身结束 | 先取消该程序，再释放环境 | 新增第二条用例 |
| 归档另一个会话 | — | 本会话的环境不受影响 | 新增第三条用例 |
| 释放失败 | — | 写入宿主日志，归档不回滚 | 新增第四条用例 |
| Agent 卸载 | 释放保留的环境（既有行为） | 不变 | 既有 `ptc.spec.ts` 用例 |

负控：在未打补丁的 master 上，新增的 4 条用例中 3 条失败（归档后 `released` 仍为空，报 `expected [] to have a length of 1 but got +0`；释放失败不产生日志）；打补丁后该包 5 个文件 / 234 条用例全部通过。

新用例把真实的 `WorkspaceRegistry` 与真实的 `PtcExecutor` 组合在一起，只有存储与持久化对端受控：`ctx.workspaceRegistry.archiveSession(sessionId)` 走的是出厂归档流程与出厂事件派发。

**Test entries**:

- 本机 `pnpm exec vitest run packages/core/tool-executor-ptc/tests/ --maxWorkers=2`：5 文件 / 234 用例全部通过。
- 本机负控：把 `packages/core/tool-executor-ptc/src/ptc.ts` 还原为 `origin/master` 后重跑同一命令：3 条新用例失败（`expected [] to have a length of 1 but got +0`、释放失败无日志），其余 231 条通过。
- 本机 `pnpm exec vitest run packages/core/tool-executor-ptc/tests/ --maxWorkers=2 --coverage --coverage.include='packages/core/tool-executor-ptc/src/**/*.ts'`：新增的 `src/archive-release.ts` 覆盖率 100%（语句 / 分支 / 函数 / 行）；`src/ptc.ts` 剩余的 13 处未覆盖与未打补丁时逐行对应，本改动未新增覆盖缺口（这些位置由仓库其他包的用例覆盖）。
- 本机 `./node_modules/.bin/tsc --noEmit -p packages/core/tool-executor-ptc/tsconfig.json`：通过。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run build`：通过。
- 本机 `pnpm run test:docs`：21 项通过。
- 本机 `pnpm run doc-sync`：41 项通过，`tool catalog` 与 `package paths` 两项失败为上游 master 既有问题（`scripts/gen-tool-catalog.ts` 与 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/` 与 master 字节一致）。
- 本机 `pnpm run verify-translation-pairing --write packages/core/tool-executor-ptc/README.md` 与 `packages/ptc-runtime/ptc-runtime-node/README.md`：已重新记录。
- 未验证：报告者提出的第二条修法（给 persistent PTC 增加 `idleMs` 空闲回收，覆盖未归档但长期闲置的会话）是配置与策略决定，本 PR 不处理；它的取舍留给维护者。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 定位到唯一自动释放点是 `agent.ctx.effect`，归档不卸载 Agent，并确认归档事件可达 Agent 作用域内的监听器。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「Agent 作用域内监听 `workspace/session-archived`，经 `PtcCalls.reset` 先取消在跑程序再释放环境，且不排入模型可见通知」。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 组合真实 Workspace 注册表与真实 PTC 执行器，补 4 条用例并跑负控。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写补丁、可选 peer 依赖、双语 README 与回归用例。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
