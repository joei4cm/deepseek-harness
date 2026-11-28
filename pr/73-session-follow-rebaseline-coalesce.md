## Motivation

上游 Discussion #11272 报告：Client 的 `Session.publishAssistantEntry()` 每收到一条 Assistant 流 `rebaseline`（revision、密集 index 或 settlement 缺口）就排一个微任务无条件调用 `events.restart()`，整个 `session/follow` 窗口随之重建；Host 与 Client 持续失步时，每一帧都触发一次完整重建（报告实测 88 秒内 6,860 次 follow 打开，约 78 次/秒），并在 0.2.2-rc.1 上仍可复现。

Refs #11272

## Changes

**Interface changes**:

None。新增的 `src/client/rebaseline-coalescer.ts` 只是 `dsh-api-session-controller` 的内部 Client 模块，不从包根导出；`REBASELINE_WINDOW_MS`（250 ms）是 Client 内部的重建节奏常量，不是部署配置。所有 Remote 方法、帧格式、配置项与持久化格式不变。

**Behavior changes**:

- 一串 `rebaseline` 中的第一条仍立即重建 follow（单次失步的修复时延不变）。
- 其后 250 ms 窗口内的 `rebaseline` 被这次重建吸收；窗口关闭时，若新 baseline 尚未到达（仍处于失步），再合并重建一次并开启下一个窗口；若新 baseline 已经到达，窗口直接关闭，不再重建。
- 因此持续失步时，follow 重建次数从“每帧一次”降为“每个 250 ms 窗口一次”；一次孤立的 rebaseline 仍只花一次重建。
- `resync()`、`disconnect()`、`dispose()` 与 follow 流失败（`failEventStream()`）都会丢弃尚未执行的合并重建及其计时器，断开后不会再重开 follow。
- `README.md` / `README.zh.md` 中描述 Assistant 缺口重开 follow 的段落补充了上述合并节奏。

**Module responsibilities and dependencies**:

None。没有新增或删除包，也没有新增或删除工作区包之间的运行时依赖；合并逻辑仍归 `dsh-api-session-controller` 的 Client Session 所有。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 单次 rebaseline | 立即重建 1 次 | 立即重建 1 次 | `session.client.spec.ts`：`rebuilds follow once per window …`；既有 `sessions-service.client.spec.ts`：`replaces an invalid settlement with the authoritative post-end baseline`（仍为 2 次 follow 打开） |
| 首次重建后同一窗口内再来 20 帧失步 | 再重建若干次（负对照：共 4 次打开，而非 2 次） | 不再重建，窗口关闭时合并为 1 次 | `session.client.spec.ts`：`rebuilds follow once per window for a rebaseline storm instead of once per frame` |
| 窗口关闭时已有新 baseline | — | 不再重建；之后新的一串失步仍立即重建 | 同上；`rebaseline-coalescer.client.spec.ts` |
| 失步未解决时 Session 断开 | 断开前的 5 帧失步已额外重建（负对照：共 4 次打开，而非 2 次）；无合并计时器 | 计时器与待重建被丢弃，断开后 follow 不再打开，`openState` 为 `cold` | `session.client.spec.ts`：`drops an unresolved storm when the Session disconnects` |
| 合并器自身：首个立即重建、窗口吸收、未解决时按窗口重建、`resolve()` 停止重建、`dispose()` 清理计时器 | — | 全部按上述语义 | `rebaseline-coalescer.client.spec.ts`（4 个用例，100% 覆盖） |

**Performance**：在 Remote mock 上用假计时器模拟 2 秒持续失步（每帧都推进 follow revision 且 chunk index 跳号），分别以 10 ms 与 50 ms 帧间隔运行，统计首次打开之后的 follow 重建次数。条件：本机 Linux，Node v24.22.3，单 worker；计数取 `mock.log.requests('session/follow')`，与墙钟无关。该测量用例为临时代码，未提交。

| 帧间隔 | 帧数 | 改动前重建次数 | 改动后重建次数 |
|---|---|---|---|
| 10 ms | 200 | 200 | 9 |
| 50 ms | 40 | 40 | 9 |

改动后 9 次 = 首帧立即 1 次 + 2 秒内 8 个 250 ms 窗口各 1 次，与帧率无关。

**Test entries**（全部为本地运行）:

- 新增与相关测试：`pnpm exec vitest run packages/api/session-controller/tests --maxWorkers=2 --coverage --coverage.include='packages/api/session-controller/src/client/rebaseline-coalescer.ts'`：53 个文件、1165 个测试全部通过，新模块 100% 覆盖。
- 负对照：把 `src/client/sessions/session.ts` 临时还原为 `master`（`4b399c39a6`）后，`-t 'assistant rebaseline'` 的 2 个新用例均失败（`expected 4 to be 2`），恢复修复后通过。
- 静态检查：`verify-translation-pairing`、`run-oxlint`（改动文件）、`verify-empty-catch`、`verify-no-unknown-casts`、`verify-export-jsdoc`、`duplication`、`build`：结果见 Proof。

<details><summary>Proof</summary>

```
$ pnpm exec vitest run packages/api/session-controller/tests --maxWorkers=2 --coverage \
    --coverage.include='packages/api/session-controller/src/client/rebaseline-coalescer.ts'
 Test Files  53 passed (53)
      Tests  1165 passed (1165)
Statements   : 100% ( 21/21 )
Branches     : 100% ( 6/6 )
Functions    : 100% ( 7/7 )
Lines        : 100% ( 16/16 )

# negative control: session.ts restored to 4b399c39a6
$ pnpm exec vitest run packages/api/session-controller/tests/session.client.spec.ts -t 'assistant rebaseline'
 × rebuilds follow once per window for a rebaseline storm instead of once per frame
   AssertionError: expected 4 to be 2  (session.client.spec.ts:1468)
 × drops an unresolved storm when the Session disconnects
   AssertionError: expected 4 to be 2  (session.client.spec.ts:1500)
      Tests  2 failed | 84 skipped (86)

# measurement (temporary, not committed): 2 s continuous desync, fake timers
fixed    MEASURE frames=200 gapMs=10 followOpens=9
fixed    MEASURE frames=40  gapMs=50 followOpens=9
upstream MEASURE frames=200 gapMs=10 followOpens=200
upstream MEASURE frames=40  gapMs=50 followOpens=40

$ pnpm run verify-translation-pairing
verify-translation-pairing: 1397 pair(s) checked across all in-scope documentation, all consistent.
$ tsx scripts/run-oxlint.ts <changed files>   # exit 0, no diagnostics
$ pnpm run verify-empty-catch
verify-empty-catch: no new silent catches; 0 recorded clauses remain.
$ pnpm run verify-no-unknown-casts
verify-no-unknown-casts: no new assertions; 1199 existing assertions remain.
$ pnpm run verify-export-jsdoc
verify-export-jsdoc: every exported name in each package API is documented.
$ pnpm run duplication
Found 0 clones.
$ pnpm run build
run-gates: 10 passed, 0 failed, 0 skipped in 133.23s.
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 对照 Discussion #11272 定位每条 rebaseline 无条件 `restart()` 的根因；作者仅设定选题纪律 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择“首帧立即、窗口内合并、未解决时按窗口重建”，否决只做尾随防抖（持续失步会无限推迟修复） |
| testing 验收测试 | auto 模型自主 | 95% | Agent 编写合并器单测、Session 风暴与断开集成测试、负对照及 2 秒持续失步计数测量 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 完成合并器、Session 接线、README 双语段落与测试的全部改动 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
