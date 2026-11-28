## Motivation

撤下 Session 持久化服务（插件卸载、替换，或根 fiber 关闭）时，`dsh-subagent` 的驻留子级仍在运行，但 JSONL 后端会先撤除 live-event 路由并关闭写句柄，于是子级被中止的这一轮所发布的收尾事件（模型回复、`step/end`、`turn/end`）只留在内存里，存储日志在中途截断，恢复后与实时历史不一致。

根因：子级管理器向持久化后端发布事件、并调用 `session/flush`，却没有对 `sessionPersistence` 声明依赖，后端撤下服务时等待的依赖方中不包含它（见 `packages/session/session-persistence-jsonl/src/index.ts` 的 `apply` 文档："Consumers must own cleanup in their injecting scope"）。这是本仓自审 Cordis 生命周期时发现的缺陷，与仓库已有 proposed note `.agents/notes/proposed/architecture/2026-10-09-cordis-cleanup-dependency-lifetimes.md` 中 "Session persistence drops events emitted during cleanup"（AgentLoop 路径）属于同一类别，但该 note 没有列出子级管理器这一条路径；无上游 Discussion 涉及，故 INDEX 的 References 列为 `—`。

## Changes

**Interface changes**

None。`SubagentManager.stopResidentChildren()` 是包内类的新方法，未从包入口导出；未改配置键、事件名、协议或持久化格式。

**Behavior changes**

- `SubagentRuntime` 在已注入 `agents` 的作用域内，再开一个注入 `sessionPersistence` 的子作用域，其清理 effect 停止所有驻留子级（`stopResidentChildren()`）。持久化服务撤下时，Cordis 会等待这个依赖方卸载完毕后，才运行后端撤除路由、关闭句柄的清理；因此子级的收尾事件先写进存储日志。
- 该作用域只停止驻留子级，不关闭管理器准入：持久化后端恢复后可照常创建、续接子级。没有持久化后端的组合中，该作用域从不激活，行为不变。
- `drain()` 改为复用 `stopResidentChildren()`，行为不变。
- `packages/subagent/subagent/README.md` / `README.zh.md` 的 "Activation settlement" 一节补充一句撤下持久化服务时的停止顺序（双语同行，已重新记录 `README.i18n.yaml`）。

**Existing test behavior**：既有用例 `settles despite the persistence backend being disposed mid-run` 描述的正是被修复的行为——它先 `await` 后端卸载完成、再放行子级的模型调用，断言子级仍能结算。修复后，后端卸载会等待子级停止，这个顺序不再成立（测试用的 `GatedAdapter` 在闸门打开前不响应中止）。该用例改写为下方的回归用例，并保留原有的"无 `final session flush` 告警"断言。

**Module responsibilities and dependencies**

None。未新增或删除包，未增删工作区包之间的运行时依赖：`dsh-subagent` 已把 `dsh-session-persistence` 声明为可选 peer 依赖；本 PR 只新增一个运行时 `inject` 作用域，不改 `package.json`。

## Testing

**Test design**

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 子级的一轮仍在流式输出时撤下持久化后端 | 后端撤除立即完成；存储日志停在 `request/context`（10 个事件），回复、`step/end`、`turn/end` 丢失 | 后端撤除保持挂起，直到子级停止；存储日志与子级实时日志逐事件相等（13 个事件，以 `turn/end` 结尾） | `stores the complete child log when the persistence backend is withdrawn mid-turn` |
| 管理器整体 drain | 停止驻留子级 | 不变（复用同一方法） | 既有 `disposes every subagent tree instance on manager teardown` 等用例 |
| 无持久化后端的组合 | 正常运行 | 不变 | 既有 `persistence: false` 用例 |

回归用例用受控 promise 卡住子级的模型调用，在卡住期间撤下后端：先断言服务已从存储中移除、撤除仍未完成、子级仍驻留；再放行模型调用，等待撤除完成；随后用同一 root 重新挂载 JSONL 后端读取子级日志，与子级 Session 的实时快照逐事件比较（"live vs restored"），并断言末尾为 `turn/end`。

**Test entries**（均本地运行；CI 另跑矩阵）

- `pnpm exec vitest run packages/subagent/subagent/tests packages/api/session-controller/tests/subagent-access.host.spec.ts --maxWorkers=2 --coverage --coverage.include='packages/subagent/subagent/src/index.ts' --coverage.include='packages/subagent/subagent/src/manager.ts'` — 510 passed（含新增回归用例）；`src/index.ts` 与 `src/manager.ts` 语句/分支/函数/行 100%（742/742、406/406、156/156、647/647）。
- 负对照：在 `src/index.ts` 中去掉新增的 `sessionPersistence` 注入作用域后运行回归用例 —— **1 failed**：撤除在子级停止前就已完成（`expected true to be false`）；更早一轮只比较日志的版本显示存储日志 10 个事件、实时日志 13 个事件，缺回复、`step/end`、`turn/end`。恢复后通过。
- `pnpm run lint` — 通过（exit 0）。
- `pnpm run test:docs` — 21 passed / 0 failed（含 translation pairing，`README.i18n.yaml` 已重新记录）。
- `pnpm run doc-sync` — 43 passed / 0 failed。
- `pnpm run duplication` — 0 clones。
- `pnpm run typecheck` — 5 个 gate 全部通过（Host/client 编译器与聚合检查）。

<details><summary>Proof</summary>

```
Test Files  27 passed (27)
     Tests  510 passed (510)

Statements   : 100% ( 742/742 )
Branches     : 100% ( 406/406 )
Functions    : 100% ( 156/156 )
Lines        : 100% ( 647/647 )
```

负对照（去掉注入作用域）：

```
× stores the complete child log when the persistence backend is withdrawn mid-turn
AssertionError: expected true to be false // Object.is equality
Tests  1 failed | 169 skipped (170)
```

</details>

**Known gap**：撤除开始时仍在创建中（尚未发布为驻留）的子级不在本次停止范围内；它若在撤除期间完成发布，会持有已撤下后端的句柄。持久化服务已从存储中移除，因此撤除期间不会再准入新的需持久化子级，这一窗口仅限撤除开始时已在途的创建。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 自审 Cordis 生命周期时定位子级管理器缺少对持久化服务的依赖，并用实验复现日志截断；作者仅设定目标与纪律 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择在注入 `sessionPersistence` 的子作用域中停止驻留子级，而不关闭准入，也不改后端或 Cordis |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计受控 promise 交错、实时与恢复日志的逐事件比较，以及负对照 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 写全部源码、测试与双语 README 改动，并改写一个描述旧行为的用例 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
