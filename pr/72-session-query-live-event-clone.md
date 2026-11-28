## Motivation

上游 Discussion #13499（及更早的 #7356、#7434、#8277）报告：对一个活跃（live）Session 调用 `sessionQuery.readEvent({ sessionId, seq })` 时，`SessionCorpus.load()` 会通过 `snapshotLive()` 把整个事件数组逐条 `structuredClone`，之后 `_readEvent()` 再把目标和窗口事件各自克隆一遍；一次有界单事件读取的开销因此变成 O(历史长度)，逐条读取退化为 O(N²) 并把 Host 主线程钉死在 `structuredClone`。

`Session.snapshotEvents()` 返回的本就是按追加缓存的深度冻结数组（持久化路径的 `readColdSessionLog()` 也只被同一请求内的只读消费方使用），且 `SessionQueryEngine` 的 6 个 `load()` 调用点全部只读 `loaded.events`，对外返回事件前各自通过 `snapshotSessionEvent()` 克隆所需窗口或表面。`SessionCorpus.load()` 因此无需先整本克隆 `events`，调用方也无需重复克隆已经克隆过的 `loaded.header`。

Refs #13499

## Changes

**Interface changes**:

`dsh-session-query` 内部模块 `src/corpus.ts`（通过 `./src/*` 可达，未从包根导出）中 `LogicalSession.events` 的类型从 `SessionEvent[]` 收窄为 `readonly SessionEvent[]`，文档说明它为只读视图、对外返回事件时由调用方负责克隆。所有公开的 `SessionQueryEngine` 方法签名、返回值、错误码与配置项不变。

**Behavior changes**:

- `SessionCorpus.load()` 不再对整份事件数组做逐条 `structuredClone`：
  - 活跃 Session 分支直接借用 `session.snapshotEvents()` 缓存的深度冻结快照，不再引入任何新的同步读取调用点（仍保留原位置的 `typescript/no-deprecated` 豁免）。
  - 持久化 Session 分支直接传递 `readColdSessionLog()` 返回的 `events`，不再二次整本克隆。
- `SessionQueryEngine` 的 `readSession()`、`readSurface()` 与 `readEvent()` 直接返回 `loaded.header`（`load()` 已克隆一次），去掉第二次冗余的 `structuredClone(loaded.header)`。
- 所有公开方法的外部隔离保证不变：
  - `readEvent()` 仍对目标与 `[startSeq, endSeq]` 窗口内每个事件调用 `snapshotSessionEvent()`，返回独立克隆且深度冻结的事件以及独立的 header 副本。
  - `readSession()`、`readSurface()` 仍克隆返回的事件；`listEvents()`、`filterEvents()`、`traceEvent()` 只派生新记录，不暴露原始事件引用。
- 因此，活跃 Session 上 `readEvent()` 的克隆次数从 O(历史长度) 降为 O(窗口大小)（单事件读取固定为 1 次 header + 1 次事件克隆）；`listEvents()` 与 `traceEvent()` 不再克隆日志中的任何事件。

**Module responsibilities and dependencies**:

None。没有新增或删除任何包依赖，包职责不变。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 活跃 Session 上 `readEvent`（单事件） | 克隆整份历史 + 目标事件 + 2 次 header | 只克隆 1 次 header + 1 次目标事件，且返回结果仍与 live 状态隔离 | `session-query.spec.ts`：`clones only the header and requested window for live and persisted reads` |
| 活跃 Session 上 `readEvent`（`before: 1, after: 1`） | 克隆整份历史 + 3 个窗口事件 + 2 次 header | 只克隆 1 次 header + 3 个窗口事件（共 4 次 `structuredClone`） | 同上 |
| 活跃 Session 上 `listEvents` 与 `traceEvent` | 各克隆整份历史 | 不克隆日志中任何事件（只克隆 header） | 同上 |
| 持久化 Session 上 `readEvent`（单事件） | 后端读取后 `SessionCorpus.load()` 再整本克隆 + 目标事件克隆 | 除后端读取外，只克隆 1 次目标事件 | 同上 |
| 现有只读与窗口/错误/隔离语义 | 通过 | 全部保持不变 | `session-query`、`session-query-sqlite`、`tool-session-query` 现有测试 |

**Performance**：在 20,000 个事件（1 条 `turn/start` + 19,999 条约 1 KB 文本的 `user/message`）的活跃 Session 上，预热 `snapshotEvents()` 缓存后，执行 100 次单事件读取（`before = after = 0`），对比改动前逻辑（每次 `snapshotLive` 整本克隆 + `snapshotSessionEvent(target)` + 二次 header 克隆）与改动后 `ctx.sessionQuery.readEvent()`。条件：本机 Linux，16 核，Node v24.22.3，单 worker，`performance.now()` 墙钟时间。

| 路径 | 100 次读取总耗时 | 单次均值 |
|---|---|---|
| 改动前（整本克隆） | 8,938.9 ms | 89.39 ms/read |
| 改动后（仅克隆 header + 目标事件） | 6.4 ms | 0.064 ms/read |

**Test entries**（全部为本地运行）:

- 单元与覆盖率：`pnpm exec vitest run packages/session-query/session-query packages/session-query/session-query-sqlite packages/experimental/tool-session-query --maxWorkers=2 --coverage --coverage.include='packages/session-query/session-query/src/corpus.ts' --coverage.include='packages/session-query/session-query/src/index.ts'`：结果见 Proof。
- `pnpm run verify-no-unknown-casts`、`pnpm run verify-empty-catch`、`pnpm run lint`、`pnpm run typecheck`、`pnpm run build`、`pnpm run duplication`：结果见 Proof。

<details><summary>Proof</summary>

```
$ pnpm exec vitest run packages/session-query/session-query \
    packages/session-query/session-query-sqlite \
    packages/experimental/tool-session-query --maxWorkers=2 --coverage \
    --coverage.include='packages/session-query/session-query/src/corpus.ts' \
    --coverage.include='packages/session-query/session-query/src/index.ts'
 Test Files  9 passed (9)
      Tests  276 passed (276)
Statements   : 100% ( 201/201 )
Branches     : 100% ( 87/87 )
Functions    : 100% ( 45/45 )
Lines        : 100% ( 184/184 )

$ pnpm run verify-no-unknown-casts
verify-no-unknown-casts: no new assertions; 1199 existing assertions remain.
$ pnpm run verify-empty-catch
verify-empty-catch: no new silent catches; 0 recorded clauses remain.
$ pnpm run lint                    # exit 0
$ pnpm run typecheck
run-gates: 5 passed, 0 failed, 0 skipped in 95.46s.
$ pnpm run build
run-gates: 10 passed, 0 failed, 0 skipped in 68.80s.
$ pnpm run duplication
Found 0 clones.

$ benchmark (20,000 events, 100 reads, local Linux 16-core, Node v24.22.3)
BENCH events=20000 reads=100 before=8938.9 ms (89.39 ms/read) after=6.4 ms (0.064 ms/read)
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 对照 Discussion #13499（及 #7356）定位 `SessionCorpus.load()` 的整本事件克隆与重复 header 克隆；作者仅设定选题纪律 |
| design 方案设计 | auto 模型自主 | 95% | Agent 确认全部 6 个 `load()` 调用点只读且对外自行克隆，选择借用只读事件视图而非额外引入 live LRU 缓存 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 编写按窗口计数 `structuredClone` 的回归测试及 2 万事件单读基准 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 完成 `corpus.ts`、`index.ts` 与回归测试的全部改动 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
