<!--
状态：草稿，未发布。
用途：Discussion #14396 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/config-editor-preserve-comments` 分支（21b26b171c），未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）。
-->

# English reply

I reproduced the comment loss: saving a different field replaces the `config` YAML node and removes comments on unchanged entries. A branch on our fork, `fix/config-editor-preserve-comments`, retains unchanged mapping entries and whole unchanged sequences, including comments on standard-tagged scalars and `!!js` expressions.

There are limits: a changed sequence or a reset can still remove comments. If the document or replacement contains YAML anchors or aliases, the editor uses its existing whole-node replacement so that reused nodes do not break references; comments can still be lost in that case. The existing replacement path also has unresolved alias cases involving `!!js` expressions or anchors referenced from another row.

The integration tests cover unchanged comments, nested sequences, tagged scalars, expressions and an ordinary alias. The original comment-loss test failed before the change. Full validation and availability are recorded in the accompanying PR description.

# 中文对照

已复现：保存其他字段时整体替换 `config` YAML 节点，使未修改条目的注释丢失。fork 分支 `fix/config-editor-preserve-comments` 会保留未修改的映射条目和完整未修改的序列，包括标准标签标量与 `!!js` 表达式上的注释。

限制：修改序列或重置配置仍可能丢注释；文档或新配置含 YAML 锚点或别名时，编辑器沿用整体替换，以免复用节点造成引用失效，因此仍可能丢注释。原有替换路径对引用 `!!js` 表达式的别名和跨行锚点还有无法保存的情况。

集成测试覆盖未修改的注释、嵌套序列、标签、表达式及普通别名；原始丢注释用例在修复前失败。完整验证与交付状态见配套 PR 描述。
