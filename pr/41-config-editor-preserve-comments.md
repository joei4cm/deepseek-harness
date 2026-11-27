## Motivation

保存 profile 配置时，配置编辑器整体替换 `config` YAML 节点，导致未修改字段中的注释丢失。Refs #14396

## Changes

**Interface changes**: None。

**Behavior changes**:

- 编辑现有配置映射时，复用未修改的标量、映射键和完整序列节点，以保留这些位置的 YAML 注释及标量格式；更新或删除的值以新配置为准。
- 显式标准标签和未修改的 `!!js` 表达式保留对应节点。为避免复用锚点后破坏别名，文档或新配置含 YAML 引用时沿用原有整体替换路径；序列发生变化或配置被重置时，相关注释仍可能丢失。
- 更新包 README 英中对，说明保留范围和限制。独立复核发现：别名引用 `!!js` 表达式以及其他行引用被替换的锚点时，原有整体重写路径仍可能无法保存；这些情况不属于此次保留注释的覆盖范围。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**:

| 场景 | 原行为 | 修改后 | 覆盖 |
|---|---|---|---|
| 更新字段，其他字段有行前和行尾注释 | 注释丢失 | 未修改的节点保留注释 | `preserves comments on untouched configuration while editing a live field` |
| 未修改列表中有注释 | 列表被重建 | 完整未修改列表保留注释 | `preserves nested and sequence comments on untouched values` |
| 未修改值带标准标签或 `!!js` | 注释丢失 | 节点和注释保留 | `preserves comments on explicitly tagged values and expressions` |
| 配置含 YAML 锚点和别名 | 整体替换 | 整体替换，生成的引用仍可解析 | `keeps alias references valid when editing another field` |

负控：在修改实现前运行第一条新增回归，因保存后缺少行前注释而失败。

**Test entries**:

- 本机 `pnpm exec vitest run packages/settings/settings/tests/ --maxWorkers=2`：5 个文件，51 个测试通过。
- 本机 `pnpm run build`：通过。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run verify-translation-pairing packages/boot/config-editor/README.md`：通过。
- 本机 `pnpm run doc-sync`：`tool catalog` 和 `package paths` 两项失败；前者缺 `tool-working-directory`，后者引用已删除的 `ptc-runtime-python` 路径，均为基线上既有问题。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 根据讨论复现配置注释丢失并定位节点替换。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择复用未改变节点，并在含引用时保留原替换路径。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计注释、标签、表达式与别名回归并运行负控。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 实现配置编辑和文档变更。 |
| review 评审处理 | auto 模型自主 | 100% | Agent 根据独立代码复核处理锚点和标签问题。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
