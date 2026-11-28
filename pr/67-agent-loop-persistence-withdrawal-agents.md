## Motivation

撤下 Session 持久化服务（插件卸载或替换）时，`dsh-agent-loop` 创建的存活 Agent 不会被停止，而 JSONL 后端会撤除 live-event 路由并关闭写句柄；此后这些 Agent 发布的事件（被中止这一轮的收尾 `step/end`、`turn/end` 等）只留在内存里，存储日志在中途截断，恢复后与实时历史不一致。

根因：AgentLoop 经由后端路由发布 Session 事件、在 teardown 中关闭写句柄，却没有在任何作用域中对 `sessionPersistence` 声明依赖，后端撤下服务时等待的依赖方中不包含它（见 `packages/session/session-persistence-jsonl/src/index.ts` 的 `apply` 文档："Consumers must own cleanup in their injecting scope"）。这是仓库已有 proposed note `.agents/notes/proposed/architecture/2026-10-09-cordis-cleanup-dependency-lifetimes.md` 中 "Session persistence drops events emitted during cleanup" 所述的 AgentLoop 路径，由本仓自审确认并复现；本 PR 只修复该路径，不修改 note。无上游 Discussion 涉及，故 INDEX 的 References 列为 `—`。同类缺陷的子级管理器路径见 PR 66（`fix/subagent-persistence-withdrawal-children`），两者互不依赖。

## Changes

**Interface changes**

None。`FactoryOwnership.stopLiveAgents()` 是包内私有类的新方法，未导出；未改配置键、事件名、协议或持久化格式。

**Behavior changes**

- `AgentLoop` 在初始化时新增一个注入 `sessionPersistence` 的子作用域（包在带标签的 effect `agentLoop.persistenceAgents()` 中，保持"顶层无裸 `ctx.plugin()` effect"的既有约定），其清理 effect 停止所有存活 Agent（`stopLiveAgents()`）。持久化服务撤下时，Cordis 会等待这个依赖方卸载完毕，才运行后端撤除路由、关闭句柄的清理；因此每个被中止的 turn 先提交收尾事件，再关闭写句柄。
- 存活 Agent 的跟踪从创建事务开始，所以撤除开始时仍在创建中的 Agent 同样被回滚。
- 该作用域只停止存活 Agent，不关闭工厂准入：持久化后端恢复后可照常创建、恢复 Agent。停止过程中的 teardown 失败会汇总抛出，由 Cordis 记录到日志，撤除本身仍会完成。没有持久化后端的组合中，该作用域从不激活，行为不变。
- `packages/core/agent-loop/README.md` / `README.zh.md` 的实现一节、`docs/architecture.md` / `architecture.zh.md` 的生命周期一句各补充撤下后端时的停止顺序（双语同行，已重新记录两个 `.i18n.yaml`）。
- TypeScript / Python SDK 的 expected output 不受影响：本 PR 不改变正常运行、关闭或 `SessionEventMap` 的事件序列，只改变撤下持久化后端这一场景中 Agent 的停止时机。

**Module responsibilities and dependencies**

None。未新增或删除包，未增删工作区包之间的运行时依赖：`dsh-agent-loop` 已在运行时使用 `sessionPersistence`；本 PR 只新增一个运行时 `inject` 作用域，不改 `package.json`。

## Testing

**Test design**

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| Agent 的一轮挂起在模型调用中时撤下持久化后端（`backend-first`、`loop-first` 两种挂载顺序） | 后端撤除立即完成，Agent 继续运行；实时日志停在 `request/context`，之后的收尾事件无法再写入存储 | 撤除先停止 Agent；实时日志以 `turn/end` 结尾，存储日志与实时日志逐事件相等 | `persists the live closing events of an agent stopped by backend withdrawal` |
| 撤除时 Agent teardown 失败 | 撤除不停止 Agent | 撤除完成，Agent 已从注册表移除，失败经 logger 报告 | `completes backend withdrawal and reports an agent teardown failure` |
| 根 fiber 关闭时排空已缓冲事件 | 通过 | 不变 | 既有 `persists buffered turn events without an explicit flush before dispose` |
| 顶层不出现裸 `ctx.plugin()` effect | 通过 | 不变（新作用域包在带标签的 effect 中） | 既有 `config-session-id.spec.ts` 中的标签用例 |

回归用例用 `MockAdapter(['hang'])` 让 Agent 的模型调用挂起，等到请求已发出后撤下后端；随后用同一 root 重新挂载 JSONL 后端读取日志，与该 Agent Session 的实时快照逐事件比较（"live vs restored"），并断言实时日志末尾为 `turn/end`。

**Test entries**（均本地运行；CI 另跑矩阵）

- `pnpm exec vitest run packages/core/agent-loop/tests --maxWorkers=2 --coverage --coverage.include='packages/core/agent-loop/src/index.ts'` — 29 个文件、518 passed（含 4 个新增用例：2 个场景 × 2 种挂载顺序）；`src/index.ts` 语句/分支/函数/行 100%（329/329、140/140、78/78、287/287）。
- 负对照：用注释替换 `src/index.ts` 中新增的注入作用域后运行 `shutdown-drain.spec.ts` —— **2 failed**（两种挂载顺序的回归用例）：`expected 'request/context' to be 'turn/end'`，即撤除后 Agent 仍未停止。恢复后 6 passed。
- `pnpm run lint` — 通过（exit 0）。
- `pnpm run test:docs` — 21 passed / 0 failed（含 translation pairing，两个 `.i18n.yaml` 已重新记录）。
- `pnpm run doc-sync` — 43 passed / 0 failed（重跑 `gen-config-catalog` 与 `gen-doc-graphs` 更新本 PR 插入引起的行号锚点）。
- `pnpm run duplication` — 0 clones。
- `pnpm run typecheck` — 5 个 gate 全部通过（Host/client 编译器与聚合检查）。

<details><summary>Proof</summary>

```
Test Files  29 passed (29)
     Tests  518 passed (518)

Statements   : 100% ( 329/329 )
Branches     : 100% ( 140/140 )
Functions    : 100% ( 78/78 )
Lines        : 100% ( 287/287 )
```

负对照（去掉注入作用域）摘要：`root shutdown drain (backend-first)` 与 `(loop-first)` 下的 `persists the live closing events of an agent stopped by backend withdrawal` 均失败，断言信息为 `expected 'request/context' to be 'turn/end'`；共 2 failed。

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 依据仓库 proposed note 选定 AgentLoop 路径，并用挂起的模型调用复现撤除后 Agent 未停止；作者仅设定目标与纪律 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择在带标签 effect 内注入 `sessionPersistence` 并停止存活 Agent，而不关闭准入，也不改后端或 Cordis |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计两种挂载顺序下实时与恢复日志的逐事件比较、teardown 失败路径和负对照 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 写全部源码、测试与双语 README、架构文档改动 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
