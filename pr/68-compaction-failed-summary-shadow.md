## Motivation

上游 Discussion #14472 报告：一次压缩失败之后，日志里留下了一条 `compaction/summary`，它声明的区间包含受保护的 system head；下次打开该 Session 时，`dsh-session-format-v3-to-v4` 的关系校验重放该 summary 的区间，报 `SessionFormatError: compaction cannot shadow the protected system head`，整段历史不可加载，且每次压缩复发。

根因分两侧：

- 写入侧：`dsh-compaction-basic` 先单独追加 `compaction/summary`，再追加替换它的 checkpoint `user/message`。两次追加之间 checkpoint 可能被 Session 拒绝（报告中的那一次就是被 surface 规则拒绝），此时 summary 行已经落盘，而它声明的遮蔽从未发生——一条声称遮蔽了区间的记录，对应一次没有发生的遮蔽。
- 读取侧：关系校验对每条 `compaction/summary` 一律要求其区间是当前 surface 的精确跨度且不含 protected head。但一次失败的压缩根本没有 checkpoint，它声明的区间什么也没遮蔽；这条规则把一次失败的压缩变成了整段日志的毒行。

修复分两侧，与上游 Discussion 中 argszero 的分析一致：写入侧把 summary 与 checkpoint 作为一次 group 追加（`Session.append` 的数组形式，`packages/core/session/README.md:96` 已记录该形式：先校验全部候选再改动日志），checkpoint 被拒时整组都不落盘；读取侧对「没有成功完成的压缩」的 summary 豁免区间规则——只有成功完成的压缩才真的遮蔽了区间。

Refs #14472

## Changes

**Interface changes**:

None。未改配置键、事件名、事件负载字段、协议或持久化格式；读取侧只放宽一条关系校验，不新增事件或字段。

**Behavior changes**:

- 压缩提交改为一次 group 追加：`compaction/summary` 与替换它的 checkpoint `user/message` 同批提交。checkpoint 被 Session 拒绝时，日志里不再留下 summary 行。
- 工具结果剪枝同理：`compaction/prune` 与替换它的 `tool/result` 同批提交，被拒的替换不会留下定价行。
- 关系校验对「未成功完成的压缩」的 `compaction/summary` 豁免 surface 区间规则：这类 summary 描述的是一次没有发生的遮蔽，其区间不指向任何当前 surface 节点。已经写入这类行的日志（例如 #14472 报告的会话）现在可以再次打开。
- 成功完成的压缩仍按原规则校验：其 summary 的区间必须是当前 surface 的精确跨度，且不含 protected head。
- 压缩失败时记录的 `compaction/end`（携带错误）行为不变。

**Existing test behavior**:

两个既有用例原来单独 mock `compaction/summary` 追加失败，以断言 commit 阶段的错误分类。group 形式下 summary 与 checkpoint 同批提交，mock 改为拒绝整组；断言（错误码 `commit`、`compaction/end` 携带的错误、admission 释放、不 flush）不变。

**Module responsibilities and dependencies**:

None。未新增或删除包，未增删工作区包之间的运行时依赖：`dsh-compaction-basic` 与 `dsh-compaction-tool-result-pruner` 继续使用已声明的 `@deepseek-ai/dsh-session`，本次只改用其已文档化的数组追加形式；`dsh-session-format-v3-to-v4` 的依赖不变。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| Session 拒绝压缩的 checkpoint | 日志留下 `compaction/summary`，声称遮蔽从未发生的区间 | 日志只有 `compaction/start` 与 `compaction/end` | `records no summary when the checkpoint cannot be admitted` |
| 失败的压缩留下 summary 行后重新打开 | `SessionFormatError: compaction cannot shadow the protected system head` | 打开成功 | `accepts the stale summary of a compaction that never completed` |
| 成功完成的压缩声明了错误区间 | 拒绝 | 拒绝（规则不变） | 同一用例的后半段 |

写入侧用例让 Session 拒绝 checkpoint 那一组追加，断言压缩事件序列里没有 `compaction/summary`；读取侧用例按 #14472 的形状构造日志：一次失败的压缩，其 summary 声明的区间正是 protected head 所在节点。

**Test entries**（均本地运行；CI 另跑矩阵）:

- `pnpm exec vitest run packages/compaction/compaction-basic/tests packages/compaction/compaction-image-offload/tests packages/compaction/compaction-tool-result-pruner/tests packages/session/session-format-v3-to-v4/tests --maxWorkers=2 --coverage --coverage.include='packages/compaction/compaction-basic/src/region.ts' --coverage.include='packages/compaction/compaction-tool-result-pruner/src/index.ts' --coverage.include='packages/session/session-format-v3-to-v4/src/relationships.ts'` — 635 passed；三个改动源文件语句/分支/函数/行 100%（533/533、443/443、52/52、446/446）。
- 负对照一：还原写入侧的 group 追加后运行写入侧用例 —— **1 failed**：日志事件为 `['compaction/start', 'compaction/summary', 'compaction/end']`，即留下了声称已遮蔽的 summary 行；恢复后通过。
- 负对照二：还原读取侧的豁免后运行读取侧用例 —— **1 failed**：`SessionFormatError: compaction cannot shadow the protected system head`；恢复后通过。
- `pnpm run lint` — 通过（exit 0）。
- `pnpm run typecheck` — 5 个 gate 全部通过。
- `pnpm run doc-sync` — 通过。

<details><summary>Proof</summary>

```
Test Files  29 passed (29)
     Tests  635 passed (635)

Statements   : 100% ( 533/533 )
Branches     : 100% ( 443/443 )
Functions    : 100% ( 52/52 )
Lines        : 100% ( 446/446 )
```

负对照一（写入侧还原为两次追加）：

```
× records no summary when the checkpoint cannot be admitted
  [ "compaction/start", "compaction/summary", "compaction/end" ]
Tests  1 failed | 33 skipped (34)
```

负对照二（读取侧还原为无豁免）：

```
× accepts the stale summary of a compaction that never completed
  SessionFormatError: compaction cannot shadow the protected system head
Tests  1 failed | 61 skipped (62)
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 对照 Discussion #14472 的日志证据定位写入侧与读取侧两处缺陷；作者仅设定目标与纪律 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择用 `Session.append` 的数组形式让 summary 与 checkpoint 同批提交，并在关系校验侧对未成功完成的压缩豁免区间规则 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计被拒 checkpoint 与失败压缩重开两个场景，并各配一次负对照 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 写全部源码、测试与双语 README 改动，并改写两个 mock 旧追加形状的既有用例 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
