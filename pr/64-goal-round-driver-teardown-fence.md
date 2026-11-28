## Motivation

`dsh-goal-round-driver` 的 teardown 承诺两件事（README「Fail-closed teardown」）：关准入、等驱动器与 agent 完全停稳，且**事件防护在等待期间保持生效**。这两条在代码里都没有真正成立。

第一处：复合 effect `ctx.effect(function* () { … })` 里的 10 个 `ctx.on(...)` 监听器**没有 yield**。`ctx.on` 走 `fiber.effect`，其 disposer 是 fiber 级 `_disposables` 的独立条目；`fiber._unload` 用 `Promise.all` 并发释放所有条目。于是这些监听器与 teardown 的清理**并发**释放，而不是在清理完成之后——源码注释「composite effect removes listeners only after its promise settles」描述的顺序从未发生。最先失效的是 `agent/pre-step` 栅栏：teardown 仍在等待 agent 停稳时，陈旧的 goal 输入已经没有任何东西拒绝它。

第二处：teardown 只对 `agent.status === 'running'` 的 agent 调 `cancel`。但 `ReactLoopAgent.status` 在 `maintenance` 相位下**也**返回 `'idle'`（`packages/core/agent-loop/src/agent.ts:155`）。于是排在 `runMaintenance` 之后的预留既不会被 `cancel` 清空，也不会被 `inbox.remove` 撤回——它留在 inbox 里成为一次 latch 的唤醒，在驱动器已卸载、栅栏已失效之后启动一个**孤立的 Round**（一次越权的模型请求，且消耗 `roundsStarted`）。

两处都指向同一份代码 `packages/goal/goal-round-driver/src/index.ts`（复合 effect 与 teardown 收尾）。这是本仓自审发现的缺陷（无上游 Discussion 涉及），故 INDEX 的 Discussion 列为 `—`。

## Changes

**Interface changes**

None。未改配置键、公共导出、协议或持久化格式。

**Behavior changes**

- 复合 effect 现在 **yield** 每个 `ctx.on(...)` 监听器，栅栏与监听器随该 effect 一并在 teardown 的 drain 结束之后才释放，与源码注释和 README 的「event fence remains installed」一致。
- teardown 对**非 running** 的 agent 不再跳过预留：它撤回仍处于排队状态的 goal 消息（`agent.inbox.remove`，对已被认领/准入的 id 是幂等的 no-op），因此 maintenance 之后的 latch 唤醒不会启动孤立 Round；撤回失败（持久化写入报错）只记录 warn，teardown 继续。
- teardown 对**任何**持有预留的 agent 都等待 `agent.whenIdle()`，不再只等待 running 的 agent——这正是「await the driver plus agent quiescence」的字面含义。
- 行为矩阵（场景 × 改动前 × 改动后 × 覆盖测试）：

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 插件卸载时 Round 已排队、agent 处于 maintenance | 预留留在 inbox；maintenance 结束后 latch 唤醒启动孤立 Round（一次越权模型请求） | 预留被撤回；无 `turn/start`、无模型请求、goal 保持 active 且 `disarmed` | `withdraws a round queued behind maintenance and holds teardown until the agent settles` |
| 插件卸载等待 agent 停稳期间到达陈旧 goal 输入 | `agent/pre-step` 栅栏已随 fiber 并发释放，无人拒绝该输入 | 栅栏仍在，拒绝该输入，turn 以 `blocked` 结束 | `keeps the pre-step fence rejecting stale goal input while teardown waits` |
| 撤回排队预留时持久化写入失败 | —（该路径不存在） | 记录 warn，teardown 照常完成 | `finishes teardown when withdrawing a queued reservation fails` |
| 插件卸载时 Round 已 admitted、agent 正在跑 | `cancel({kind:'parent'})` + 等 agent 停稳 | 不变 | 既有 `disarms and cancels an admitted round before driver teardown completes` |
| 正常轮次、暂停、封顶、重启 | 不变 | 不变 | 既有 62 个用例全绿 |

**Module responsibilities and dependencies**

None。未新增或删除 workspace 运行时依赖，未移动包职责。

## Testing

**Test design**

纯行为修复，验证目标是两个可复现的非法交错：

1. **maintenance 交错**：用真实 `agent.runMaintenance` 持有 agent（maintenance 相位下 `status` 报告 `idle`），让驱动器把 Round 排进 inbox，随后卸载驱动器。改动前 latch 唤醒在 maintenance 结束后启动孤立 Round（`turn/start` 落盘 + 一次模型请求）；改动后预留被撤回，既无 `turn/start` 也无模型请求。
2. **栅栏交错**：让一个 Round 进入模型调用后卸载驱动器，并在 `turn/end` 发布之后用 `queueMicrotask` 投递一条外来 goal 消息（`session.append` 不允许在 `turn/end` 发布回调里重入，直接 `followup` 会被吞掉并只留一条 warn）。这条消息在 teardown 仍等待 agent 时抵达 step 栅栏：改动前栅栏已消失（turn 以 `aborted` 收尾且无人拒绝该输入），改动后栅栏拒绝它（turn 以 `blocked` 收尾）。
3. **失败路径**：用 `vi.spyOn(agent.inbox, 'remove')` 让撤回抛错，断言 teardown 仍完成且 goal 保持 `disarmed`。

**Test entries**（均本地运行；CI 另跑矩阵）

- `pnpm exec vitest run packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts --coverage --coverage.include='packages/goal/goal-round-driver/src/**/*.ts' --maxWorkers=2` — 65 passed；语句/分支/函数/行 100%（250/250、169/169、37/37、225/225）。
- 负对照：`git checkout HEAD -- packages/goal/goal-round-driver/src/index.ts`（还原到上游 master `4b399c39a6` 的内容）后运行三个新用例 —— **3 failed / 3 passed**，失败的正是三个新用例；恢复后 65/65 通过。
- `pnpm run lint` — 通过（exit 0）。
- `pnpm run test:docs` — 21 passed / 0 failed。
- `pnpm run doc-sync` — 43 passed / 0 failed。
- `pnpm exec tsc -b tsconfig.host.json` — 首次报 2 处 `TS2554`（`Promise.withResolvers<undefined>().resolve()` 需要显式实参），改为 `resolve(undefined)` 后通过；pre-push hook 的 typecheck 5 gates 亦通过。

<details><summary>Proof</summary>

```
Test Files  1 passed (1)
     Tests  65 passed (65)

Statements   : 100% ( 250/250 )
Branches     : 100% ( 169/169 )
Functions    : 100% ( 37/37 )
Lines        : 100% ( 225/225 )
```

负对照（master 源码 + 三个新用例）：`Tests  3 failed | 3 passed (65)` —— 失败的正是三个新用例。

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 自审 `packages/goal/goal-round-driver` 时定位两处 P0：未 yield 的监听器与 maintenance 相位下的预留撤回；用户仅设定目标与纪律 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择最小改法：yield 全部监听器 + 撤回非 running 预留 + 对任何预留等待 agent 停稳；未改动轮次调度策略 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计 maintenance 与栅栏两个确定性交错及一条失败路径用例，并做负对照 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 写全部源码、测试与双语文档改动 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
