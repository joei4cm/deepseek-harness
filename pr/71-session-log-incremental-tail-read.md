## Motivation

上游 Discussion #14320 报告：对同一个当前版本的 Session 日志，每次读取都把整份文件重新读入、重新解压（zstd）并逐行重新解析，因此一个持续写入的长 Session 每追加一批事件，下一次读取就要付出整段历史的代价；在多 Session 的 `dsh web` 服务器上，这让进程每 10–25 分钟就因堆耗尽而退出。

原因是解码结果只按文件修订号缓存（`coldLogMemo`，2 个条目），而每次追加都会改变修订号，缓存对活跃 Session 从不命中。报告者给出的原型保留每个 Session 的解码器与已消费的字节偏移，文件只是变长时只解码新增的字节；本 PR 按同一思路实现，并补上校验与回退。`session/list` 遍历整个语料库的开销是另一个问题，不在本 PR 范围内。

Refs #14320

## Changes

**Interface changes**:

配置键、事件、`SessionPersistence` 服务方法、持久化格式与 `dsh-session-format` 的导出都不变。`dsh-session-persistence-jsonl` 通过 `./src/*` 可达的 `src/format.ts` 新增三项导出：`openLogScan(buffer)` 返回未结束的 `SessionLogScanner`；`SessionLogScanner.settle()` 在不结束扫描的情况下校验并返回事件的副本；`SessionLogScan` 类型改为导出。`scanLog(buffer)` 的行为不变。`SessionFormatRestore.finish()` 与 `SessionFormatArtifactDecoder.finish()` 的 JSDoc 补充了一条已有实现本就满足的约定（见下）。

**Behavior changes**:

- 当前版本日志的读取保留最近读取的 8 个日志的已打开解码状态，这些日志合计最多保留 250,000 个事件；超出时按最久未读的顺序释放，单个日志超过 250,000 个事件时不保留。两个上限都是内部复用策略常量（与 `COLD_LOG_MEMO_MAX_ENTRIES` 同类），不是部署配置。
- 日志只是变长时，读取只读入并解码新增的字节，重新对整个日志运行一次关系检查（id、名称与生命周期），只校验并冻结新增的事件。zstd 与 `compression: 'none'` 两种编码都适用；本进程的追加与其他进程的追加都走这条路径。
- 继续读取的前提逐条检查：同一路径、同一 device 与 inode、文件变长、上次已消费部分的最后 64 字节未变、新增部分不以撕裂的帧或行结尾，且解码器确认全部输入都已提交。任一条件不满足、同一 Session 有并发读取，或继续解码出现任何失败，读取都回退为现有的完整解码，错误分类仍由完整解码给出；取消照常传播。
- 日志未变时（大小与修订号相同），读取直接返回保留的结果，即使 `coldLogMemo` 已将它逐出。
- 报告者的原型每 64 次增量读取做一次完整的行重新校验；本 PR 没有采用。保留的状态只有在文件仍是同一 inode、只是变长、且已消费部分的结尾字节未变时才会被继续使用，而本后端从不原地改写已提交的字节（`list()` 复用表头的逻辑依赖同一前提）；其余情况都回退到完整解码。新增事件每次都经过与完整读取相同的校验，整个日志的关系检查每次都重新运行，因此定期全量重验不会检查到额外的内容。

两处 README（英文与中文）同步说明继续读取、两个保留上限与回退条件；`dsh-session-format` 的 README 说明当前版本的 restore 可以在 `finish()` 之后继续解码。

**`dsh-session-format` 约定**：当前版本的 restore 不经过迁移阶段，`finish()` 只做校验、不改变解码器状态，所以之后到达的行可以继续解码并再次 `finish()`，每次结果都覆盖至今的全部行；结果可能共享一个之后会继续增长的事件数组，发布事件的调用方需要复制。迁移中的 restore 仍只 `finish()` 一次。现有的 v1→v2、v2→v3、v3→v4 解码器的 `finish()` 本就是纯校验，代码不需要改动。

**Existing test behavior**:

`jsonl.spec.ts` 中 4 个关于 `coldLogMemo` 的测试原先断言「追加之后的读取会完整重读文件」，这正是本 PR 改变的行为：

- `an unchanged cold log parses once across an observe-then-resume handoff`：追加之后的读取不再整份重读文件，整份读取的计数保持为 1。
- `a foreign write misses the memo through the revision guard`：另一个后端实例追加之后，读取继续保留的解码状态，整份读取的计数为 0。
- `the cold-log memo keeps only the handoff window and evicts the oldest id`：断言 memo 保留 `[second, third]`，并在重读第一个 Session 前清空 `logTails`，以继续检验 memo 逐出后的完整读取。
- `a handle read retries once when the file revision changes during the read` 与 `a continuously churning revision yields the committed prefix instead of looping`：通过同一个辅助函数同时清空两个缓存，保持它们原本检验的完整读取路径。

**Module responsibilities and dependencies**:

None。没有新增或删除包之间的依赖。`dsh-session-persistence-jsonl` 在自己的读取路径里保留解码状态；`dsh-session-format` 只补充 `finish()` 的文档约定。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 本进程或其他进程追加后读取 | 完整读入并解码整个文件 | 只解码新增字节，结果与完整解码相同 | `decodes only the records a %s log gained since the last read`（zstd 与 none，断言扫描器收到的文本只有新增记录） |
| 日志未变、memo 已逐出 | 完整解码 | 直接返回保留结果，不调用 `settle` | `serves an unchanged %s log without decoding after the memo evicts it` |
| 第 9 个 Session 被读取 | 不适用 | 保留最近的 8 个 | `keeps the decode state of the most recently read Sessions` |
| 保留事件超过 250,000 | 不适用 | 释放最久未读的状态；单个日志超出时自身不保留 | `keeps retained decode states within 250,000 events, evicting the least recently read` |
| 原地改写、rename 替换、截短、仅修改时间 | 完整解码 | 仍完整解码 | `decodes a %s log in full when its file was replaced, rewritten, shrunk, or touched` |
| 新增部分以撕裂的帧或行结尾 | 恢复已提交前缀 | 回退完整解码，结果相同 | `decodes a %s log in full when its appended bytes end inside a record` |
| 新增的 zstd 帧内容损坏 | 拒绝为损坏 | 回退完整解码，仍拒绝为损坏 | `reports a corrupt appended frame as a full read does` |
| 同一 Session 的并发读取 | 各自完整解码 | 一个继续读取，另一个完整解码，结果一致 | `serves concurrent reads of a grown %s log` |
| 继续读取中途取消 | 不适用 | 以取消原因拒绝；下一次读取完整解码 | `stops a continued decode at cancellation and decodes in full afterwards` |
| 当前版本 restore 在 `finish()` 之后继续 | 未约定 | 再次 `finish()` 覆盖全部行 | `catalog.spec.ts`：`continues a current restore with later rows after finish` |

**Performance**：只测量 `open(id, 'read')` 加 `read()` 加 `close()` 的墙钟时间。条件：本机 Linux，16 核，Node v24.22.3；每轮 6 个事件（助手消息约 2 KB 文本），先用 100 轮一批写入，再交替测量：追加一轮、清空两个缓存后完整读取，然后再追加一轮、继续读取；各 5 次。合成文本重复度高，zstd 压缩比远高于真实日志，所以 zstd 一列的文件大小不代表真实比例。

| 日志 | 完整读取 | 继续读取 |
|---|---|---|
| zstd，30,060 个事件（压缩后 278 KB） | 289–363 ms | 31–51 ms |
| none，30,060 个事件（36 MB） | 222–292 ms | 18–30 ms |
| zstd，90,060 个事件（压缩后 821 KB） | 545–648 ms | 47–85 ms |
| none，90,060 个事件（109 MB） | 656–983 ms | 68–89 ms |

继续读取仍随事件总数线性增长：它每次都对整个日志重新运行关系检查，并复制一次事件数组；解码与校验只针对新增部分。

**Test entries**（全部为本地运行）:

- 继续读取与解码格式：`pnpm exec vitest run packages/session/session-persistence-jsonl packages/session/session-format/tests packages/session/session-persistence-sqlite/tests/legacy-import.spec.ts packages/session/session-persistence-sqlite/tests/migration.spec.ts --maxWorkers=2 --coverage`（覆盖范围为两个包的 `src`），全部通过，覆盖率 100%。
- `pnpm run verify-no-unknown-casts`：没有新增断言；测试辅助函数复用已有的 `ctx.sessionPersistence as unknown` 断言，基线计数从 12 降为 11。
- `pnpm run typecheck`（5 个 gate）、`pnpm run lint`、`pnpm run build`（10 个 gate）、`pnpm run test:docs`（21 个 gate）、`pnpm run duplication`（0 个克隆）：全部通过。
- `pnpm run doc-sync`：42 个 gate 通过；配置目录因 `Config` 声明的源码行号下移而过期，重新生成 `docs/config-catalog.md` 与中文版后 `verify-config-catalog` 通过，生成结果随本 PR 提交。

<details><summary>Proof</summary>

```
$ pnpm exec vitest run packages/session/session-persistence-jsonl packages/session/session-format/tests \
    packages/session/session-persistence-sqlite/tests/legacy-import.spec.ts \
    packages/session/session-persistence-sqlite/tests/migration.spec.ts --maxWorkers=2 --coverage
 Test Files  29 passed (29)
      Tests  855 passed | 1 skipped (856)
Statements   : 100% ( 2120/2120 )
Branches     : 100% ( 958/958 )
Functions    : 100% ( 354/354 )
Lines        : 100% ( 1922/1922 )

$ pnpm run verify-no-unknown-casts
verify-no-unknown-casts: no new assertions; 1198 existing assertions remain.

$ pnpm run typecheck
run-gates: 5 passed, 0 failed, 0 skipped in 12.73s.
$ pnpm run lint            # exit 0
$ pnpm run build
run-gates: 10 passed, 0 failed, 0 skipped in 57.13s.
$ pnpm run test:docs
run-gates: 21 passed, 0 failed, 0 skipped in 22.00s.
$ NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
run-gates: 42 passed, 1 failed (config catalog: source line of Config moved)
$ pnpm run gen-config-catalog && pnpm run verify-config-catalog
gen-config-catalog: 3 artifact(s) are up to date.
$ pnpm run duplication
Found 0 clones.
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 对照 Discussion #14320 定位到修订号缓存在每次追加后失效，并把 `session/list` 的开销划出范围；作者仅设定选题顺序 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择保留解码器、按 inode 与结尾字节校验并回退完整解码，未采用定期全量重验 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计追加、替换、撕裂、损坏、并发与取消场景，以及完整与继续读取的对照基准 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 编写全部源码、测试与双语 README 更新 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
