## Motivation

会话目录按工作区 cwd 分桶存储。同一个 session id 出现在两个项目桶里，或某一份副本的 header 通不过身份校验时，`list()` 会拒绝整个扫描。`workspaceRegistry` 启动时调用 `list()`，`workspaceController` 又依赖 `workspaceRegistry`，于是用户在应用外把会话目录拷进另一个工作区的桶（例如由 agent 编辑 `storages/workspace.json` 执行的跨工作区移动，原副本继续接收写入）之后，这两个服务永远无法激活，每个 `workspace/create` 都报 `gateway/service-unavailable: active Service "workspaceController" is unavailable`，任何文件夹都打不开。Refs #14332

## Changes

**Interface changes**: None。`SessionPersistenceCorruptionError` 是 seam 既有的损坏错误类；身份校验失败从普通 `Error` 改为该类，错误消息不变。

**Behavior changes**:

- `list()` 不再因一份 header 身份校验失败的日志而整体拒绝。沿用既有的「损坏或不支持的日志不是被列举的 Session」契约：扫描跳过该日志，通过 logger 发出带路径的警告，磁盘文件原样保留。报告的场景（陈旧副本留在另一个桶里）由此在启动时自愈。
- 同一 id 实体化在多个项目目录时，`list()` 与 `open`/`stat` 解析到同一份权威副本：header 能指明自身物理位置的副本优先，其余平局取最新物理写入（`mtimeNs`），最后按路径做确定性平局。解析结果通过 logger 报告（写出保留与跳过的两份路径），落选副本留在磁盘上不动。
- 没有任何副本通过校验时，直接寻址的 `open`/`stat` 仍然拒绝为 `SessionPersistenceCorruptionError`；append 与 repair 之前的身份校验不变，`create` 仍拒绝一个在另一项目目录下已存在的 id。写入安全（mutation 前校验）保持归档决策 2026-07-20-jsonl-storage-identity 的原状。
- 受影响的启动链恢复：扫描不再失败后，`workspaceRegistry` 与 `workspaceController` 正常激活，`workspace/create` 可用。报告方期望的「单操作跨工作区移动」是独立的功能需求，不在本 PR 范围。

**Existing test behavior**: 三个既有用例改写为描述新行为（`list rejects a header whose cwd does not identify its physical log` → `list skips …`、`list rejects a session header whose id cannot name a storage path` → `list skips …`、`open and list reject one id materialized in multiple project directories` → `open and list resolve …`）。旧断言把「一份坏日志让整个扫描失败」当作预期，而本 PR 的动机正是这个整体失败令 workspace 服务不可用，因此行为随测试一起更改。

**Module responsibilities and dependencies**: None。改动只落在 `dsh-session-persistence-jsonl` 一个包内，没有新增或删除包间运行时依赖边，也没有职责移动。

**文档**: 包 README 双语对在「读取日志」一节新增一段读取契约（身份校验失败的日志不入列、重复 id 解析为一份权威副本、落选副本留盘），已重录 translation pairing。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 单份日志的 header cwd 指向别处 | `list()` 整体拒绝（`and cwd identify`） | 跳过 + 警告，磁盘文件不动；直接 `open` 仍拒绝 | `list skips a header whose cwd does not identify its physical log` |
| header id 无法命名存储路径 | `list()` 整体拒绝 | 跳过 + 警告 | `list skips a session header whose id cannot name a storage path` |
| 同一 id 在两个桶、各自 header 指明自己的桶 | `list()`/`open` 均拒绝 | 列举与 open 都解析到最新副本；警告报出两份路径；落选副本留盘 | `open and list resolve one id materialized in multiple project directories` |
| 报告的跨工作区移动：自洽原副本 + 桶外陈旧副本（副本即使更新也落选） | 启动扫描失败 | 列举与 open 都指向自洽副本 | `list keeps the self-consistent copy when a duplicate is misplaced` |
| 两份副本都通不过身份校验 | duplicate 抛错 | 列举跳过两份；直接 open 仍拒绝，不落到损坏数据上 | `open stays loud when every duplicate copy fails identity validation` |
| 无重复、自洽的常规列举与打开 | 不变 | 不变 | 既有包内用例全绿 |

负控：把 `packages/session/session-persistence-jsonl/src/index.ts` 备份到 /tmp 后用 `git checkout origin/master -- <path>` 还原到修复前，5 个新增/改写用例全部失败（`list()` 仍整体拒绝、重复 id 仍抛 duplicate 错误）；恢复实现后全绿。

**Test entries**:

- `pnpm exec vitest run packages/session/session-persistence-jsonl/tests/ --maxWorkers=2` — 23 个文件、790 个用例通过（本机）。
- `pnpm exec vitest run packages/session/ --maxWorkers=2` — 131 个文件、2836 个用例通过（本机），覆盖 seam 契约、`session-query-sqlite` 物化与 `workspace` registry 等下游消费方。
- `pnpm run build` — 10 个 gate 通过（本机）。
- `pnpm run typecheck` — 5 个 gate 通过（本机）。
- `pnpm run lint` — 通过（本机）。
- `pnpm run doc-sync` — 41 个 gate 通过，2 个失败（本机）。两个失败为上游 master 既有问题，与本改动无关：`tool catalog` 报 `tool-working-directory` 未列入 `scripts/gen-tool-catalog.ts` 的 `TOOL_PACKAGES`；`package paths` 报 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/guide.md` 指向不存在的 `packages/experimental/ptc-runtime-python/README.md`。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 从报告还原出两条失败路径（身份校验失败的副本与各自自洽的重复 id），并核对启动依赖链 `workspaceRegistry` → `workspaceController`。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「listing 层跳过与解析、直接寻址与写入前校验保持响亮」的分层；身份校验失败改用 seam 既有的损坏错误类，复用「损坏日志不入列」契约，不引入新的错误类型或配置项。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计 5 个行为用例并执行负控（还原修复前源码，验证新用例失败）。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 完成全部源码、测试与双语 README 改动；作者未做 diff 审阅。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
