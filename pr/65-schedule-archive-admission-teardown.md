## Motivation

`dsh-schedule` 的归档准入（archive admission）监听器是 fiber 级注册：插件卸载时，它们与服务自己的 drain **并发**释放，而不是在 drain 结束之后。于是在卸载期间发生的归档会被放行——尽管服务当时仍持有该 Session 的活动任务；这些行随归档留存，之后每次投递都因 `schedule/target-archived` 失败并反复告警。同时，到达 drain 期间的归档停止请求会被 teardown 闸门（`Schedule service is stopping`）拒绝，被它负责删除的行同样活过归档。

两处都指向同一份代码 `packages/schedule/schedule/src/index.ts`（归档准入监听器的注册与 drain 的收尾）。这是本仓自审发现的缺陷（无上游 Discussion 涉及），故 INDEX 的 Discussion 列为 `—`。

## Changes

**Interface changes**

None。未改配置键、公共导出、事件名、协议或持久化格式。

**Behavior changes**

- 归档准入的两个监听器（`workspace/session-activity`、`workspace/session-stop`）现在由**一个复合 effect** 持有（`ctx.effect(function* …)`，yield 两个监听器的 disposer），因此它们在本服务自己的 drain 结束之后才释放。卸载期间发生的归档仍能看到本服务持有的活动任务，归档会被拒绝，而不是在服务仍持有这些行时放行。
- 归档停止即使在服务 drain 期间也会排入队列：停止路径不再经过 teardown 闸门（该闸门只挡新的管理写入），drain 则等到队列里不再有等待期间新排入的工作为止，然后才关闭领域（domain）。于是停止删除的行在领域关闭前确实被删除。
- 行为矩阵（场景 × 改动前 × 改动后 × 覆盖测试）：

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 插件卸载期间归档一个仍有活动任务的 Session | 归档被放行（监听器已随 fiber 释放），活动行随归档留存 | 归档被拒绝：准入仍报告该 Session 的活动任务 | `keeps the archive admission installed while the service drains` |
| 卸载期间到达归档停止 | 停止被 teardown 闸门拒绝，行未被删除 | 停止排入队列，并在领域关闭前删除这些行 | `deletes the armed rows when an archive stop arrives during the drain` |
| 领域打开失败，服务从未持有领域 | —（无等待 drain 的拆除流程） | 不会 drain 时释放等待 drain 的拆除流程，卸载不挂起 | 既有恢复用例 `rejects startup on an invalid store without writes and reads it after repair` |
| 正常运行时的归档准入、停止与投递 | 不变 | 不变 | 既有 772 个用例全绿 |

**Module responsibilities and dependencies**

None。未新增或删除包，未增删工作区包之间的运行时依赖，未移动包职责。

## Testing

**Test design**

纯行为修复，验证目标是两个可复现的非法交错（均在新文件 `packages/schedule/schedule/tests/teardown.spec.ts`）：

1. **卸载与归档的交错**：用受控的后端行写入闸门占住服务的队列，使卸载启动的 drain 一直挂起；随后询问归档准入（`ctx.waterfall('workspace/session-activity', …)`）。改动前监听器已随 fiber 释放，准入返回空数组（归档会被放行）；改动后准入仍报告该 Session 的活动任务。
2. **停止与 drain 的交错**：在同一挂起的 drain 中发出 `workspace/session-stop`，它排在被闸住的写入之后；释放闸门后停止仍删除这些行，且删除发生在领域关闭之前——用例在卸载结束后重新打开领域，断言任务表为空。

两条用例都用受控 promise 作闸门，不用固定 sleep；闸门在 `finally` 中释放并等待卸载结束，失败也不会留下挂起的任务。

**Test entries**（均本地运行；CI 另跑矩阵）

- `pnpm exec vitest run packages/schedule/schedule/tests --maxWorkers=2 --coverage --coverage.include='packages/schedule/schedule/src/index.ts'` — 772 passed；`packages/schedule/schedule/src/index.ts` 语句/分支/函数/行 100%（298/298、174/174、72/72、268/268）。
- 负对照：`git checkout 4b399c39a6 -- packages/schedule/schedule/src/index.ts`（还原到上游 master `4b399c39a6` 的内容）后运行两个新用例 —— **2 failed**：准入得到 `[]` 而非活动任务；停止之后任务表仍留两行。恢复后 2/2 通过。
- `pnpm exec vitest run packages/schedule/tool-schedule/tests packages/api/remotes/tests --maxWorkers=2` — 67 passed（依赖 schedule 包的包）。
- `pnpm run lint` — 通过（exit 0）。
- `pnpm run test:docs` — 21 passed / 0 failed。
- `pnpm run doc-sync` — 43 passed / 0 failed。
- `pnpm run duplication` — 0 clones。
- `NODE_OPTIONS="--max-old-space-size=8192" pnpm exec tsc -b tsconfig.host.json` — 通过。

<details><summary>Proof</summary>

```
Test Files  1 passed (1)
     Tests  2 passed (2)

Statements   : 100% ( 298/298 )
Branches     : 100% ( 174/174 )
Functions    : 100% ( 72/72 )
Lines        : 100% ( 268/268 )
```

负对照（master 源码 + 两个新用例）：`Tests  2 failed (2)` —— 失败的正是这两个新用例：归档准入得到 `[]`，停止之后任务表留下 `["teardown", "schedule-…"]`。

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 自审 `packages/schedule/schedule` 时定位两处 P0：归档准入监听器的释放顺序与 drain 期间的停止闸门；用户仅设定目标与纪律 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择最小改法：一个复合 effect 持有两个监听器、停止绕过 teardown 闸门、drain 等待队列静默；未改归档准入策略与持久化格式 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计两个确定性交错（被闸住的后端写入制造挂起的 drain）及负对照 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 写全部源码、测试与双语文档改动 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
