## Motivation

`bundle-in-use` 只回一个错误码：用户看不到是哪些条目仍占着这个组合包，也看不到是谁声明了它们。工具给出的下一步——「停用其他层仍在使用这个组合包的条目」——对只有 profile 根配置 `cordis.yml` 残留该行的情形根本不成立：那个文件由启动器在每次启动时重写为空条目表，会话内没有开关可以关掉它，于是用户只能盯着一个无法行动的错误。Refs #14345

## Changes

**Interface changes**: `ManagementFailure` 新增可选第三个构造参数 `diagnostic?: string`，承载调用方本地化文案之后展示的技术细节；`ManagementError.diagnostic` 早已存在，本次开始承载 `bundle-in-use` 的诊断。`ManagementError` 的线上形状不变。

**Behavior changes**:

- `removeBundle` 拒绝卸载时带上诊断：点名仍在运行的条目（id 与解析后的模块名），以及仍声明它的那一层——某个组合包层、profile 自己的 `cordis.patch.yml`、home patch、启动 overlay，或 profile 根配置。最后一种情形附带说明：该文件由启动器在每次启动时重写为空条目表，下次启动即清除残留行。
- 「仍在使用」的判定集合不变：仍是同一 `(id, name)` 且 fiber 在运行的条目。诊断只把已有的判定结果讲出来，不放宽也不收紧任何拒绝。
- 声明来源只看各层 patch 中 `insert:` 的行。override 行只修改别处声明的行，它本身不构成声明——这正是配置编辑器写下的设置行的情形。
- Web 页面把诊断接在本地化句子之后；`operation-error` 仍单独展示诊断，其余拒绝码在没有诊断时仍只有本地化句子。

**GUI demonstration**: 本改动会改变用户可见的拒绝文案（诊断追加在本地化句子之后）。按仓库规则，GUI 改动需要来自真实服务端的演示 GIF；本机 `gh` 为 2.86.0，低于 `gh --attach` 所需的 2.99.0，因此没有嵌入 GIF。

**Module responsibilities and dependencies**: None（改动只在 `dsh-plugin-manager` 的失败类型与移除路径、`dsh-client-ui-plugin-manager` 的展示函数，以及两处各自的测试内；无包间依赖变化。）

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 组合包的组件被启动 overlay 声明 | `bundle-in-use`，无诊断 | 诊断点名该条目与该 overlay | 'names the entries that keep a bundle in use' |
| 只有 profile 根配置仍列着该行 | `bundle-in-use`，无诊断 | 诊断点名该条目与根配置，并说明下次启动即清除 | 'names the profile root config when only it keeps a bundle in use' |
| 组件的配置编辑器设置行存在 | 卸载成功 | 不变：设置行不占用组件 | 'removes a bundle whose component the config editor configured' |
| 拒绝没有诊断 | 只有本地化句子 | 不变 | 'keeps the localized sentence alone when the Host names no detail' |
| `operation-error` | 只显示诊断 | 不变 | 'shows the Host diagnostic alone for an operation error' |

负控：把 `packages/boot/plugin-manager/src/index.ts`、`packages/boot/plugin-manager/src/failure.ts` 与 `packages/client/ui-plugin-manager/src/client/presentation.ts` 用 `git checkout HEAD -- <path>` 还原到修复前，两个新的宿主端诊断用例失败（`result.error?.diagnostic` 为 `undefined`），客户端新用例失败（本地化句子后没有诊断）；应用实现后全绿。

**Test entries**:

- `pnpm exec vitest run packages/boot/plugin-manager/tests/manager.spec.ts --maxWorkers=2` — 164 个用例通过（本机）。
- `pnpm exec vitest run packages/client/ui-plugin-manager/tests/presentation.client.spec.ts --maxWorkers=2` — 3 个用例通过（本机）。
- `pnpm run test:gui` — 740 个文件、12956 个用例通过（本机）。首跑有 1 个失败落在 `packages/client/connection/tests/binary-rpc.host.spec.ts`（连接层用例，与本改动无关），随后两次重跑全绿。
- `pnpm run build` — 10 个 gate 通过（本机）。
- `pnpm run typecheck` — 5 个 gate 通过（本机）。
- `pnpm run lint` — 通过（本机；仅存一处与本改动无关的既有 warning）。
- `pnpm run doc-sync` — 43 个 gate 全过（本机）。
- 推送时的 pre-push typecheck — 通过（本机）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 逐条核对报告给出的根因，在当前 master 上复现失败与成功两种路径，确认「设置行占用组件」不成立，并把真正的占用者缩小到其他层与 profile 根配置。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「拒绝时点名占用者与声明层」的方向：判定集合不变，只补诊断，工具与页面的下一步因此可执行。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计行为矩阵与负控，并用还原源文件的方式证明新用例在修复前失败。 |
| implementation 技术实现 | auto 模型自主 | 100% | 诊断生成、失败类型与客户端展示由 Agent 编写，双语 README 由 Agent 同步并记录配对。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
