## Motivation

桌面版主进程在 stdout/stderr 管道的读端消失后，任何一次 `console.*` 写入都会以异步 `error` 事件抛出 `EPIPE`；没有监听器时它成为未捕获异常，Electron 弹出阻塞式错误框，主进程在用户点掉前无响应（Discussion #14451；同一缺陷此前在 #11809、#7888 中被独立报告，0.2.2-rc.1 探针确认一路未修）。

## Changes

**Interface changes**: None。

**Behavior changes**:

- 桌面主进程在任何其他模块求值前（`main.ts` 首个 import）为 `process.stdout` 与 `process.stderr` 各挂一个 `error` 监听：管道已断开时没有任何消费者，写入失败被丢弃，不再升级为未捕获异常与 Electron 崩溃框。覆盖 electron-updater 的 console logger 及主进程内全部 `console.*` 调用。
- 监听按进程幂等（`Object.defineProperty` 标记），模块在同一进程内重复求值不会叠加监听。
- 管道完好时行为完全不变；非 EPIPE 的流错误同样被丢弃——流已不可用，崩溃不是可恢复路径。

**Module responsibilities and dependencies**: None（`apps/desktop` 内新增私有模块，无新运行时依赖）。

## Testing

**Test design**（行为矩阵）：

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| stdout/stderr 管道读端消失后写入 | `error` 事件无监听 → 未捕获异常 → Electron 错误框 | 错误被丢弃，进程继续 | 新 spec 断言两条流的 `error` 监听存在且 `emit('error', EPIPE)` 不抛出 |
| 模块在同进程重复求值（测试 resetModules） | — | 每条流至多一个守卫监听 | 新 spec 第二用例：resetModules 后重新 import，listenerCount 不变 |
| 管道完好 | 正常输出 | 不变 | 既有 main-startup spec 187 用例全部通过 |

**Existing test behavior**: None。

**Test entries**:

- 本机 `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run apps/desktop/tests/stdio-guard.spec.ts --maxWorkers=2`：2/2 通过。
- 本机 `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run apps/desktop/tests/main-startup.spec.ts --maxWorkers=2`：187/187 通过（`main.ts` 新增首个 import 不影响启动行为）。
- 负控（Node 层）：`process.stdout.emit('error', …)` 在无监听时抛出 `EPIPE`、挂监听后吞掉——与报告的未捕获异常机制一致。
- 本机 `pnpm exec tsc -b apps/desktop/tsconfig.host.json apps/desktop/tsconfig.client.json`：通过；`pnpm run lint:contracts-ready`：通过；推送钩子 typecheck：5 项门禁通过。
- 未在打包 Electron 环境实测（报告者已在 rc.5 asar 上验证过等价补丁：13 次 EPIPE 全部被接住、进程存活 95s、无对话框）。上游不接受外部 PR，分支暂存于 fork，无 CI 结果。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 通读 #14451/#11809/#7888 三个讨论与报告者的受控复现，确认缺陷为主进程 stdio 无 error 监听、修复面收窄到 main 进程。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择首个 import 的副作用模块 + 按进程幂等标记；不引入 uncaughtException 兜底、不改 Host 子进程。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 新增 2 用例 spec、跑通 main-startup 187 用例、Node 层负控与 lint/typecheck。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写 stdio-guard 模块、main.ts 接入、spec 与本描述。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
