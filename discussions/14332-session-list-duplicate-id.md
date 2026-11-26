<!--
状态：草稿，未发布。
用途：Discussion #14332 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/session-list-duplicate-id` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）。
-->

# English reply (for posting to Discussion #14332)

Your failure chain is exact, and I reproduced both halves of it on current `master` (`4b399c39a6`). One correction to the picture: on master, the state you produced (a stale copy in B's bucket whose header still names A) actually fails *before* the duplicate check — the listing's header read validates that each log sits where its header says (`assertStoredIdentity`), and your B copy fails that with `corrupt session log … header id … and cwd identify …`, which rejects `list()` just the same. The duplicate throw you quoted fires for the variant where each copy individually names its own bucket. Both paths brick `workspaceRegistry` → `workspaceController`, so both needed fixing.

My branch (`fix/session-list-duplicate-id` on my fork) makes the listing scan follow its own existing contract — *an unsupported or corrupt log is not a listed Session*:

- A log whose header fails identity validation is skipped from `list()` with a warning naming its path; the file stays on disk untouched. Identity failures now surface as `SessionPersistenceCorruptionError` (same messages) so the skip routes on the type, not on message parsing.
- When one id exists in several project directories, `list()` and opens resolve to one authoritative copy: a copy whose header identifies its own physical location wins, remaining ties go to the newest physical write, then a stable path order. The resolution is logged with both paths, and the losing copy stays on disk.
- Direct access keeps failing loud when nothing trustworthy exists: `open`/`stat` still reject with the identity error when no copy passes, appends and repairs still validate identity before any mutation, and `create` still refuses an id that already exists under another project directory. Only the startup scan becomes survivable.

For your reproduction (original in A keeps receiving writes, stale copy in B): listing and opens now resolve to the A copy, the B copy is skipped with a warning, `workspaceController` starts, and `workspace/create` works again — no manual cleanup needed, and the stale copy remains on disk for inspection. Your second expectation (cross-workspace move as one operation: single directory move + header `cwd` update + membership under the existing `pendingMutation` marker) is a real feature gap and out of scope for this fix; it needs its own design since the header `cwd` is identity-bearing for the storage layout.

# 中文对照（供作者参考）

你的失败链路完全准确，我在当前 `master`（`4b399c39a6`）上把两个层面都复现了。对图景做一处修正：在你造出的状态里（陈旧副本在 B 桶、header 仍指向 A），master 上其实先于重复检查就失败了——列举读取 header 时会校验每份日志确实位于其 header 声明的位置（`assertStoredIdentity`），你的 B 副本通不过这一校验，报 `corrupt session log … header id … and cwd identify …`，同样让 `list()` 失败。你引用的 duplicate 抛错对应的是「每份副本各自指明自己的桶」的变体。两条路都会打断 `workspaceRegistry` → `workspaceController`，所以都需要修。

我的分支（fork 上的 `fix/session-list-duplicate-id`）让列举扫描遵循它自己既有的契约——*损坏或不支持的日志不是被列举的 Session*：

- header 身份校验失败的日志从 `list()` 中跳过，并发出带路径的警告；磁盘文件原样保留。身份校验失败现在以 `SessionPersistenceCorruptionError` 抛出（消息不变），跳过按类型路由，不解析消息文本。
- 同一 id 出现在多个项目目录时，`list()` 与 open 解析到一份权威副本：header 能指明自身物理位置的副本优先，其余平局取最新物理写入，再按稳定路径顺序决胜。解析结果连同两份路径写入日志，落选副本留在磁盘上。
- 没有可信副本时，直接访问仍然响亮失败：`open`/`stat` 在没有副本通过校验时仍以身份错误拒绝，append 与 repair 在任何变更前仍做身份校验，`create` 仍拒绝另一项目目录下已存在的 id。只有启动扫描变得可存活。

对你报告的复现（A 中的原副本继续接收写入、B 中是陈旧副本）：列举与 open 现在解析到 A 副本，B 副本被跳过并告警，`workspaceController` 正常启动，`workspace/create` 恢复可用——不需要手工清理，陈旧副本留在盘上可查。你的第二点期望（跨工作区移动作为单操作：单次目录移动 + header `cwd` 更新 + 既有 `pendingMutation` 标记下的成员变更）是真实的功能缺口，不在本修复范围内；header `cwd` 是存储布局的身份载体，需要单独设计。
