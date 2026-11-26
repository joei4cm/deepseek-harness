## Motivation

配置编辑器只查找 profile patch 文件顶层的行来定位插件的配置，因此定义在 `- insert:` 列表中的行永远不会被命中：保存时会在文件末尾追加一行同 id 的顶层 `{ id, name, config }`，同一个插件在文件里出现两处定义，之后手工修改 insert 列表里的原行不再生效。Refs #14368

## Changes

**Interface changes**:
- `dsh-config-editor` 的 `ConfigEditor.configuration()` 对「在 profile 文件中自带配置」的条目，其 `override` 现在也可能来自 `insert:` 列表中的行，其 `inherited` 相应为下层（bundle 层与 schema 默认值）提供的配置。这是包内服务方法的语义变化，无 wire 格式、配置键或持久化格式变化。

**Behavior changes**:
- 保存配置时，编辑器写入 profile 文件中已经承载该插件配置的那一行：顶层行，或 `insert:` 列表中的行。同一文件中两处都存在时，后出现的一处生效（与 patch 应用顺序一致：后插入的行会替换先插入的条目）。
- 同一文件中不再出现同一插件的两处定义，`insert:` 列表中的原行可以继续手工编辑。
- `insert:` 列表中的配置算作该插件的自有配置：其继承值是下层提供的配置，重置（`replace`）恢复该继承值，同时保留用户自己写入的非易变字段。
- 组（group）内的行仍使用顶层覆盖项形式；只有 `insert:` 列表中直接包含的行会被就地改写。
- 包 README（英/中双语）写明写入位置与继承语义，并新增一条已知限制。

**Module responsibilities and dependencies**: None（改动全部落在 `dsh-config-editor` 包内，回归测试位于 `dsh-settings` 包，无新增或删除的包间运行时依赖）。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 保存 `insert:` 列表中定义的插件 | 文件末尾追加一行同 id 的顶层覆盖项，同一插件出现两处定义 | 就地改写 insert 列表中的那一行，文件仍只有一处定义 | `config-editor-insert.spec.ts` 的 `rewrites the row inside a same-file insert list instead of adding a top-level override` |
| 同文件既有 insert 行又有顶层覆盖行 | 顶层覆盖行被更新 | 顶层覆盖行仍被更新（后出现的一处生效），insert 行保持原样 | `keeps a same-file top-level override ahead of the inserted row` |
| 重置 `insert:` 列表中定义的插件 | 顶层覆盖项被删除，insert 行里的配置保持不变 | 恢复下层继承值，用户写入的非易变字段保留 | `restores the inherited value of an inserted row and keeps the config the user wrote` |
| 读取 `insert:` 列表中定义的插件 | `inherited` 为 insert 行里的配置，`override` 为空 | `inherited` 为下层配置（空），`override` 为 insert 行里的配置 | `reports the config of an inserted row as the user layer` |

负控：把 `packages/boot/config-editor/src` 还原到改前版本后，新增的 4 个用例中 2 个失败（就地改写与层级报告两例），另 2 个作为回归护栏保持通过。

**Test entries**:
- `pnpm exec vitest run packages/settings/settings/tests/ --maxWorkers=2` — 6 个文件、51 个用例通过（本机）。
- `pnpm exec vitest run packages/boot/plugin-market/tests/configuration.spec.ts packages/experimental/speech-to-text/tests/configuration.spec.ts packages/api/settings-controller/tests/settings-controller.host.spec.ts packages/mcp/mcp-manager/tests --maxWorkers=2` — 6 个文件、102 个用例通过（本机）。
- `pnpm exec vitest run packages/experimental/cua-macos/tests/provider-lifecycle.spec.ts --maxWorkers=2` — 1 个文件、86 个用例通过（本机）。
- `pnpm run typecheck` — 通过（本机）。
- `pnpm run lint` — 通过（本机）。
- `pnpm run doc-sync` — 43 个 gate 全过（本机）。
- 推送时的 pre-push typecheck：5 个 gate 全过（本机，~93s）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据上游报告定位到 `edit()` 只查找顶层行，并进一步确认重置路径依赖「insert 行的配置是否算继承值」这一读模型。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择「profile 文件中一个插件只有一处自有配置，写入该处；后出现的一处生效」，而非追加第二处定义或仅在文档中说明覆盖项语义。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计四场景行为矩阵，并以负控验证新增用例覆盖该回归。 |
| implementation 技术实现 | auto 模型自主 | 100% | 代码、spec 与 README 双语改动由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
