## Motivation

Discussion #14263 报告：长跑 `dsh web` 宿主反复堆外内存中止（`Reached heap limit`），堆快照的支配链里有一条具体的保留路径——`follow (generator) → env_1.stack → [3] → observation (209.8 MB)`。报告定位准确，且可直接从代码证实：

`WebController.follow()` 用 `using observation` 取得打开快照用的观测租约，并在 `yield opening` 之前显式 `observation[Symbol.dispose]()`。但 `using` 的资源登记记录（持有该对象引用）会一直留在**生成器的资源栈**上，直到生成器结束；而 `follow` 流的生命周期等于「客户端开着这个会话」的时长。于是：每个打开着长会话的浏览器标签页/手机端，都把「已释放的 observation 连同其背后的整份事件历史」钉在堆里——正是报告堆快照中每个打开视图一份完整副本的来源。

在 master 上的核对结论：

1. 释放时序本身是对的（首个帧交付前租约已结束），问题纯粹是「对象引用经 `using` 记账残留」——生成器只有在流关闭时才弹出资源栈。
2. 修复不需要动 `SessionObservation` 的释放语义（报告的方案 3，影响面大），只需把 observation 的 `using` 作用域收敛到「第一个 yield 之前」就结束的代码块（报告的方案 2）。
3. 报告的第 2、3 项请求（观察缓存与 cold-log memo 按字节限容、长会话窗口化历史）是更大的内存治理议题，本 PR 不动。

Refs #14263

## Changes

**Interface changes**

- 无公开 API 变化。`follow()` 的帧序列、首帧内容与释放时序完全不变；变化仅是打开观测对象在首个 yield 之后不再可达。

**Behavior changes**

- `WebController.follow()`：打开快照的构建移入私有方法 `opening()`，observation 的 `using` 作用域随该方法返回而关闭——在第一个 yield 之前。生成器本体只持有快照帧、游标与队列增量。
- `promote`（activation 提升）的调用时序、失败时 `promotion` 的释放、以及「首个帧交付前租约必结束」的顺序保证逐行保留。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-api-session-controller` | Host/Client 会话控制：创建、恢复、prompt、follow 历史、实时投影 | 变更：`follow()` 打开租约的作用域收敛 |

依赖边：无新增或删除。

调用流程（变化后）：

```text
follow(request, signal)
  queue / listener / assistantListener（using，生命周期 = 流）── 不变
  opening(...)                      ← observation 的 using 作用域到此返回即关闭
    acquire → validate → snapshot 帧 → setCursor / setOrdinalCut
    activate? retain → dispose → promote（失败则 dispose promotion）
    否则 dispose
    return opening                  ← observation 自此不可达
  yield opening
  yield* queue.items()
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 首个快照帧交付后 | 已释放的 observation 不再被生成器持有（WeakRef 在强制 GC 后清空） | `drops the opening Observation once the snapshot is delivered`（新增） |
| 无 promote 目标的 activation 请求 | 租约仍被释放（既有行为不变） | 既有 `releases the opening Observation when activation has nothing to promote` |
| live 会话 + activation | 不 promote；流按信号结束 | 既有 `does not promote a live Session when activation was requested` |
| subagent 缺失地址 | `subagent/not-found`（经过 opening 的错误映射路径） | 既有 `maps missing subagent Follow reads through the Address error` |

测试方法说明：保留类断言用 WeakRef + 强制 GC（沿用 `packages/experimental/inspector` 与 `packages/fs/tool-fs` 的既有模式）。一个坑：vitest spy 的 `mock.results` 会持有已 settle 的返回 Promise（连带 observation），断言前须 `spy.mockClear()` 清掉，否则无论修复与否都清不掉引用。

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `tests/history-controller.host.spec.ts` 新增 1 例 | 快照交付后 observation 可被回收 |

命令与结果（本地运行）：

```
pnpm exec vitest run --maxWorkers=2 packages/api/session-controller
  Test Files  52 passed (52)
  Tests  1160 passed (1160)

pnpm exec vitest run --maxWorkers=2 --coverage \
  --coverage.include='packages/api/session-controller/src/web/controller.ts' \
  packages/api/session-controller
  Statements   : 100% ( 32/32 )
  Branches     : 100% ( 12/12 )
  Functions    : 100% ( 4/4 )
  Lines        : 100% ( 31/31 )

pnpm exec oxlint packages/api/session-controller
  exit 0

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped
```

红绿证据（先写失败测试）：新测试在未改源码时失败——强制 GC 后 `WeakRef.deref()` 仍返回 observation 对象（失败输出里能看到带 `source: "live"` 与 `Symbol.dispose` 的完整观测对象）；应用修复后通过。另将源文件单独 `git stash` 复跑确认仍为红，恢复后为绿，钉住回归。

覆盖率说明：本包单独跑覆盖时 `src/client/contract/events.ts:187`（`settleAssistant` 带 `entry` 的分支）未达 100%——该文件与本 PR 无关，其覆盖由聚合 lane 里其他包的套件提供（与仓库既有情况相同，见 `test:coverage` 聚合口径）；本 PR 改动的文件逐行 100%，且未删除任何既有测试。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent confirmed the report's dominator chain directly from the source (the `using` record outlives the explicit dispose because the generator's resource stack unwinds only when the stream ends), verified the two sibling candidates first (the sidebar-title machinery is already complete on master; the PTC subCallId issue needs a session-format design decision), and checked upstream master, the fork branches, and the staged descriptions for duplication; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent chose the reporter's option 2 (close the observation's `using` scope one level above the first yield) over touching `SessionObservation` disposal semantics, and preserved the promotion timing and lease-release ordering line by line; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent wrote the WeakRef-based failing test first (red with the observation retained after forced GC, verified red again with the source stashed), discovered and documented the spy `mock.results` retention pitfall, and confirmed 100% per-file coverage on the changed file; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent extracted the opening helper, kept the frame construction and promotion logic verbatim, and wrote the test and its GC helper following the repo's existing retention-test pattern. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
