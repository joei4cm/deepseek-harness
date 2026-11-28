## Motivation

上游 Discussion #13994 报告：在 git 仓库里，`dsh-workspace-changes` 让每一轮在结束时都多等一段时间，即使模型立即作答也一样——300 个与 1 万个文件的仓库约 0.3 秒，6 万个文件约 1.5 秒（最多 5 秒，第一轮约 10 秒）。

原因有两处。一是 `agent/turn-stopping` 的监听器要等轮末快照、diff 与摘要全部完成才返回，而 agent-loop 在这个监听器返回之后才写 `turn/end`。二是每次快照都把仓库的 index 复制到一个新的临时 index，于是每一个修改过的与未跟踪的文件都要重新读取、重新散列。报告提出的两条建议正对应这两处：不让 `turn/end` 等快照；复用上一次快照的 index，只重新散列变化了的文件。本 PR 两条都实现。

Refs #13994

## Changes

**Interface changes**:

None。配置键、事件名、事件负载、`workspaceChanges` 服务方法与持久化格式都不变。

**Behavior changes**:

- 轮次不再等待轮末记录：`agent/turn-stopping` 把记录排入该 Session 的队列后立即返回，摘要准备好后再追加 `workspace/changes`。因此这个事件现在落在 `turn/end` 之后，而不是之前。快照拍摄的时刻不变：队列在两种做法下都在同一位置执行它。
- 轮尾条目订阅所在轮次的记录数据源：`dsh-client-ui-deliverables` 的轮尾卡片原先只在渲染时读一次轮次数据，而晚于 `turn/end` 的宣告发生在轮尾节点构建之后，卡片会因此缺失；现在通过键控订阅在数据发布时重渲染。宣告先于或晚于 `turn/end` 到达都照常渲染。
- 记录的等待没有消失，只是不再挡住轮次结束。下一轮的第一个工具调用仍要等队列中的工作完成（这一点原本就成立，防止快照与修改竞争），所以只有在上一轮的记录尚未完成时就发出工具调用，那个调用才会等待剩下的部分。
- 同一 Session 的快照共用一个 index，存放在该 Session 自己的临时目录里：第一次快照从仓库的 index 复制，之后的快照复用它，`git add` 依据 index 里的文件状态跳过没有变化的文件。第一次快照的开销不变。
- 一次失败的 `git add` 或 `write-tree` 会删除这个 index 及其 `.lock`，下一次快照重新从仓库的 index 复制，不会因为残留的锁一直失败。
- 共用 index 带来两条边界情况：
  - 在两次快照之间变得不可读的文件保留上一次快照的内容，而不是从快照中消失、在摘要里显示为删除。
  - 已被某次快照收录、之后才写进 `.gitignore` 的文件仍留在后续快照里，而不是消失。
- 在 `turn/end` 之后、记录完成之前关闭 Session 或停止 Host，会中止这一轮的记录，这一轮没有摘要。这段时间的长度与原来相同，原来它位于 `turn/end` 之前。

两处 README（英文与中文）同步说明共用 index、摘要在轮次结束后宣告，以及不可读文件这一条限制。

**Existing test behavior**:

- `plugin.spec.ts` 中原先断言「摘要在 `turn/end` 之前」的测试改为断言新的顺序：`agent/turn-stopping` 返回时还没有摘要，记录完成后摘要出现，且序号大于 `turn/end`。转向与晚到工具结果的第二次记录、以及空列表取代先前记录这两条语义不变。
- `current-directory.spec.ts` 与 `git.spec.ts` 中在轮次停止后立即读取摘要的断言，改为先等待记录完成。
- `changed-files-turn.e2e.ts` 在轮次稳定后立即读取 `workspace/changes` 的断言，改为轮询等待（摘要不再持有轮次）。
- 4 个 Web 回放夹具中的 `workspace/changes` 都位于 `turn/end` 之前，按新顺序重新生成：`changed-files-turn`、`optional-string-editor`、`permission-policy-context`、`present-svg` 的 `session.v4.jsonl`。只有事件顺序与序号变化。
- `ui-deliverables` 的客户端规格新增一条：轮尾构建后记录数据才发布时，卡片照常渲染（订阅生效的回归证据）；`TestTurnDataStore` 升级为可通知订阅者的测试替身。

**GUI**：没有嵌入 GIF。轮末变更卡片的内容、位置与交互都不变，只是宣告晚于 `turn/end`。为承接晚到的宣告，`dsh-client-ui-deliverables` 的轮尾条目改为订阅所在轮次的记录数据源（`owner.turn.data` 的 `deliverables` 键）：原先它只在渲染时读一次，而轮尾节点在 `turn/end` 就已构建，晚到的宣告不会再触发渲染，卡片就不再出现（Web 回放 `ui.expected.md` 在改动后缺失该卡片 10 行，作为缺陷证据）。修复后，宣告先于或晚于 `turn/end` 到达都照常渲染；同一问题在 ui-schedule 的轮尾读取上不存在（其数据在轮内结算）。4 个 Web 回放测试照常渲染卡片。

**Module responsibilities and dependencies**:

None。没有新增或删除包之间的依赖。`dsh-workspace-changes` 调整轮末记录的时序与快照 index；`dsh-client-ui-deliverables` 为其轮尾条目补上晚到记录数据的订阅；两个包的职责都不变。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 模型停止后轮次结束 | `agent/turn-stopping` 等快照与 diff 完成，摘要在 `turn/end` 之前 | 监听器立即返回，摘要在 `turn/end` 之后 | `plugin.spec.ts`：`records when the agent stops without holding the turn, and again after turn/end only when tools settled later` |
| 转向或晚到的工具结果 | `turn/end` 再记录一次 | 不变 | 同一测试的第 2 轮，仍断言两次宣告 `['two.txt']`、`[]` |
| 第二次快照遇到一个未变化、已不可读的文件 | 新 index 读不到它，快照中缺少该文件 | 共用 index 不再读取它，快照保留其内容 | `git.spec.ts`：`reuses one index between snapshots, so an unchanged file is not read again`（仅 POSIX） |
| `git add` 失败 | 临时 index 随临时目录删除 | 共用 index 被删除，下一次重新复制 | `git.spec.ts`：`discards the index a failed snapshot left behind` |
| 摘要晚于 `turn/end` 时的 Web 界面 | 夹具中摘要在 `turn/end` 之前 | 夹具按新顺序重新生成；轮尾条目订阅轮次记录数据，卡片照常渲染 | 4 个 Web 回放测试（见 Test entries）；`deliverables.client.spec.tsx`：`renders a record that settles after the Turn closed without new owner props` |

**Performance**：只测量快照本身（`git add --all --ignore-errors` 加 `write-tree`），用的命令与环境变量和 `snapshotTree` 相同。条件：本机 Linux，16 核，Node v24.22.3，git 2.53.0；仓库有 1 万个已提交的文件和 300 个各 100 KB 的未跟踪文件；两种做法各用一个空的对象目录，各连续快照 4 次，工作区不变；取 `date +%s%N` 的墙钟时间。

| 快照 | 改动前：每次复制仓库的 index | 改动后：共用一个 index |
|---|---|---|
| 第 1 次（写入所有对象） | 1121 ms | 1128 ms |
| 第 2–4 次（工作区不变） | 156 / 185 / 141 ms | 35 / 33 / 46 ms |

第 2 次起每次少用约 95–150 ms。此外轮次本身不再等待这段时间，所以 Discussion 报告的轮末等待从轮次的关键路径上移除；本机没有复现 6 万文件规模的测量。

**Test entries**（全部为本地运行）:

- `pnpm exec vitest run packages/deliverables/workspace-changes --maxWorkers=2`：10 个文件、64 个测试全部通过。
- 覆盖率：`pnpm exec vitest run packages/deliverables/workspace-changes --coverage --coverage.include='packages/deliverables/workspace-changes/src/**/*.ts' --maxWorkers=1 --testTimeout=60000`：64 个测试通过，没有低于阈值的文件。本机较慢，2 个 worker 加覆盖率时，未改动的 `worktree.spec.ts` 等 git 密集测试会超过本地默认的 5 秒超时；CI 的覆盖率通道使用 90 秒超时。
- `pnpm run typecheck`：5 个 gate 通过。`pnpm run lint`：通过。`pnpm run build`：10 个 gate 通过。
- `pnpm run test:docs`：21 个 gate 通过。`pnpm run doc-sync`：43 个 gate 通过。
- Web 回放（`DSH_SNAPSHOT=replay`，最终构建）：4 个受影响场景全部通过——`changed-files-turn`（8 个测试）与 `present-svg`（3 个）在约 65 秒内通过，`standalone-string-editor` 与 `permission-policy-context`（合计 5 个测试）在约 28 秒内通过；重放对照的 `ui.expected.md` 金样与已提交版本一致（卡片照常渲染）。

<details><summary>Proof</summary>

```
$ pnpm exec vitest run packages/deliverables/workspace-changes --maxWorkers=2
 Test Files  10 passed (10)
      Tests  64 passed (64)

$ NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
run-gates: 43 passed, 0 failed, 0 skipped in 99.39s.

$ pnpm run build
run-gates: 10 passed, 0 failed, 0 skipped in 64.99s.

$ bash bench.sh
fresh: 1121 156 185 141 ms (first, then three later snapshots)
persistent: 1128 35 33 46 ms (first, then three later snapshots)

$ DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts \
    apps/web/tests/changed-files-turn.e2e.ts apps/web/tests/present-svg.e2e.ts
 Test Files  2 passed (2)
      Tests  11 passed (11)

$ DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts \
    apps/web/tests/standalone-string-editor.e2e.ts apps/web/tests/permission-policy-context.e2e.ts
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 对照 Discussion #13994 定位到 `agent/turn-stopping` 的等待与每次快照复制 index；作者仅设定选题顺序与工作纪律 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择排队记录不占用轮次、Session 私有共用 index 及失败时删除重建，并经测量排除 untracked cache |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计顺序断言、不可读文件与失败自愈测试，以及对称的快照基准 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 编写全部源码、测试、双语 README 与夹具更新 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
