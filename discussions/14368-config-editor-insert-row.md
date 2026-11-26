<!--
状态：草稿，未发布。
用途：Discussion #14368 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/config-editor-insert-row-edit` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）；报告中的复现路径在当前代码树中逐条核对过。
-->

# English reply (for posting to Discussion #14368)

Your diagnosis matches the current tree, and the line you pointed at is the whole mechanism: `ConfigEditor.edit()` looks for the plugin's row with `document.contents.items.findLastIndex(...)`, and that predicate only accepts top-level rows — `!item.has('insert')`. A row inside a top-level `- insert:` list is never a candidate, so the edit appends a second `{ id, name, config }` row instead. The override then wins, which is exactly why a later hand edit to the inserted row stops having any effect.

I took your first option and made the edit rewrite the row that already carries the config, on a fork branch (`fix/config-editor-insert-row-edit`, based on upstream `master`):

1. **The write lands on the row that carries the plugin's config.** That is a top-level row, or a row directly inside an `insert:` list. When a file holds both, the later one wins — the same order the patch application uses, since a later inserted entry replaces an earlier one. So an edited plugin keeps one definition in the file, and your inserted row stays editable by hand.
2. **A config inside an `insert:` list counts as the plugin's own config.** Its inherited value is therefore what the layers below provide (a bundle layer, or the schema default for a plugin only the profile defines), and the profile row is what the settings form reports as the user layer. A reset restores that inherited value while keeping the fields you wrote yourself — for example a non-volatile field stays in the row, and only the edited field returns to its default.
3. **Regression tests cover the paths.** `packages/settings/settings/tests/config-editor-insert.spec.ts` pins the in-place rewrite, the precedence of a later top-level override, the reset, and the reported layers; against the pre-change sources two of the four fail with the duplicate row you described.

Two scope notes. A row nested *inside a group* that an `insert:` list introduces is still edited through a top-level override — the group's own config is a child list rather than a plugin config, so it keeps the previous form; that is recorded as a limitation in the package README. And the plugin enable/disable toggle is a separate path (`writePluginEnabled`) that writes its own top-level `{ id, disabled }` row; I left it alone, because a disabled flag is not a config and does not shadow the row's config.

The branch and a full pull-request description are ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

# 中文对照（仅供作者阅读，不发布）

你的定位与当前代码树一致，你指出的那一行就是全部机制：`ConfigEditor.edit()` 用 `document.contents.items.findLastIndex(...)` 查找插件所在的行，而该谓词只接受顶层行（`!item.has('insert')`）。顶层 `- insert:` 列表中的行永远不满足条件，于是保存时改为追加一行 `{ id, name, config }`。覆盖项随后生效——这正是之后手工修改 insert 列表里的原行不再有效果的原因。

我采用了你的第一个方案，在 fork 分支（`fix/config-editor-insert-row-edit`，基于上游 `master`）上让保存就地改写已经承载该配置的那一行：

1. **写入落在承载该插件配置的行上。** 也就是顶层行，或 `insert:` 列表中直接包含的行。同一文件里两处都有时，后出现的一处生效——这与 patch 的应用顺序一致，因为后插入的条目会替换先插入的条目。于是被编辑的插件在文件中只保留一处定义，你插入的那一行仍然可以手工编辑。
2. **`insert:` 列表中的配置算作该插件的自有配置。** 因此它的继承值来自下层（bundle 层，或只由 profile 定义的插件的 schema 默认值），而 profile 中的这一行是设置表单作为用户层报告的内容。重置会恢复该继承值，同时保留你自己写入的字段——例如非易变字段仍留在该行，只有被编辑的字段回到默认值。
3. **回归测试覆盖这些路径。** `packages/settings/settings/tests/config-editor-insert.spec.ts` 固定了就地改写、后出现的顶层覆盖项优先、重置以及层级报告；在改前的源码上，四个用例中有两个失败，失败形态正是你描述的那行重复定义。

两点范围说明。`insert:` 列表引入的**组内部**的行仍然通过顶层覆盖项编辑——组的 config 是子条目列表而不是插件配置，因此保持原有形式，这一点已记入包 README 的已知限制。另外，插件启用/禁用开关走的是另一条路径（`writePluginEnabled`），它写入自己的顶层 `{ id, disabled }` 行；我没有动它，因为 disabled 标志不是 config，也不会遮蔽该行的 config。

分支与完整的 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。
