## Motivation

Discussion #14245 报告：侧边栏全局面板入口和会话视图标签的固定/取消固定选择只保存在内存里，Web 或 Desktop 重启后就会恢复默认，用户必须反复重新收起自己不想看的入口。两个包各自的 README 也明确记录了这一点：侧边栏“Choices reset when the plugin reloads”，会话视图的 View 列表同样只在插件内存中保存。

从 master 源码证实：`packages/client/ui-sidebar/src/client/panel-pins.ts` 的 `createPanelPins()` 与 `packages/client/ui-conversation/src/client/view-pins.ts` 的 `createViewPins()` 都只创建本插件内的 snapshot store；没有任何 Host 设置入口，也没有重启恢复路径。仓库里已有成熟的用户设置模式：会话插件的 `ComposerSubmissionPolicy` 通过 `ctx.configForms.get('ui-conversation')` 读取 Host 的 volatile 配置字段，并在浏览器侧立即发布本地值。本 PR 按 Discussion 的提案沿用这条路径，同时补上两处“加载中点击”和“写入被拒绝”的竞态保护。

Refs #14245

## Changes

**Interface changes**

- `dsh-client-ui-sidebar` 的 Host 入口从空 `apply` 变为一个函数插件配置：新增 volatile Config 字段 `unpinnedPanels: string[]`（默认 `[]`），并注入 `settings` 以 `configure({ auto: false })` 注册用户设置。
- `dsh-client-ui-conversation` 的 `ConversationSettings` 新增 volatile 字段 `unpinnedViews: string[]`（默认 `[]`），同步到浏览器配置表单。
- 两个客户端 pin 工厂分别增加 `dispose()`，用于释放 Host 设置订阅；实现会忽略固定入口（`plugins` / `chat`）。

**Behavior changes**

- 侧边栏面板和会话视图的取消固定选择持久化到用户设置文档，并在同一配置文件重启后恢复。
- 设置尚未到达浏览器时用户的点击不会覆盖已保存选择：选择会先缓冲，Host 值到达后合并并一次性写回。
- 写入在途时 UI 保持乐观值，不会被较早 Host 快照覆盖；写入被拒绝或传输失败时恢复到最近一次被 Host 接受的列表，并向控制台报告失败。
- 未注册的入口 id 仍保留在已保存列表里，避免插件暂时不可用导致用户选择丢失。
- 旧 localStorage 值继续被忽略，不产生额外迁移。
- **GUI disclosure**: 本 PR 改变的是重启后的恢复与写入失败恢复，不改动固定菜单的样式、布局或交互路径；当前 `gh` 为 2.86，低于附件要求 2.99，无法按规范创建含真实服务器 GIF 的 PR。工作区同时存在其他仓库验证任务，真实应用演示尚未录制。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-client-ui-sidebar` | 侧边栏 shell 与全局面板导航 | 变更：新增 Host 设置字段；浏览器 pin 列表接入用户设置并处理加载前选择、写入拒绝和订阅清理 |
| `dsh-client-ui-conversation` | 会话 shell、输入和 View 标签 | 变更：设置 schema 增加 `unpinnedViews`；View pin 列表复用同一会话设置表单并处理在途写入竞态 |
| `dsh-settings`、`dsh-client-ui-settings` | Host 用户设置文档、浏览器 ConfigForm | 不变，被两个功能插件复用 |
| `dsh-client-ui-slots` | Slot 组合 | 不变；只通过既有 inject face 读取 pin 列表 |

依赖边：新增 `dsh-client-ui-sidebar → dsh-schemastery`；无删除。反向边：无。

调用流程：

```ts
// Host
export const Config = z.object({ unpinnedPanels: z.array(z.string()).default([]).volatile() })
ctx.settings.configure({ auto: false }, ctx.fiber)

// Browser
const form = ctx.configForms.get<SidebarSettings>('ui-sidebar')
const pins = createPanelPins(form)
form.subscribe(() => pins.adopt(form.getSnapshot().value))
pins.setPinned('files', false)
await form.set('unpinnedPanels', ['files'])
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 启动时读取已保存面板/View | 初始 pin 列表来自 Host 设置 | `restores accepted settings and rolls back a refused write`（sidebar）；`restores saved choices and adopts later Host changes without writing them back`（conversation） |
| Host 尚未发布设置时点击 | 合并到到达的已保存列表，写回一次 | `merges choices made before the saved settings arrive`（sidebar）；`merges choices made while settings load with the saved list`（conversation） |
| 连续两次写入，较早 Host 快照随后到达 | 保留最新乐观选择 | `keeps the latest choice while earlier writes settle`（sidebar）；`keeps the optimistic choice when an older write is refused and a newer one is in flight`（conversation） |
| Host 拒绝写入 | 恢复到最近接受列表并报告 | 上述 sidebar 测试；`restores the last accepted list when a write is refused`（conversation） |
| 传输失败 | 恢复最近接受列表并报告，不产生 unhandled rejection | `restores the last accepted list and reports a failed write without an unhandled rejection`（conversation） |
| 插件 dispose | 释放订阅，不再采用迟到写入 | `abandons the settlement of a write that is still in flight at disposal`（conversation）；两个包的 dispose 断言 |
| 固定入口 | `plugins` / `chat` 不进入可自定义列表 | 两个包既有 fixed-entry 断言 |
| 重启后恢复 | 真实 Host Settings 写入 profile patch，重新启动后恢复 | `persists unpinned panel ids to the profile patch and restores them after restart`（sidebar Host composition） |
| 清空全部取消固定 | profile patch 保留显式空列表 | `clears the persisted pin list when every panel is pinned again` |
| 非 volatile 字段 | Settings 拒绝且不写盘 | `rejects edits to fields the sidebar schema does not mark volatile` |

**Test entries**

| 文件 | 变化 |
|---|---|
| `packages/client/ui-sidebar/tests/panel-pins.client.spec.ts` | 更新持久化断言，并新增加载中点击、连续写入、拒绝恢复和重建恢复场景 |
| `packages/client/ui-conversation/tests/view-pins.client.spec.ts` | 重写为 stub ConfigForm；覆盖恢复、后续 Host 变更、加载中合并、在途写入、拒绝/失败恢复和 dispose |
| `packages/client/ui-sidebar/tests/panel-pins-settings.client.spec.ts` + `settings-profile-fixture.client.ts` | 新增：用真实 Host Settings 服务和真实 profile patch 验证写入、清空、拒绝和重启恢复 |
| `packages/client/ui-conversation/tests/config.host.spec.ts` | 校验 `unpinnedViews` 默认值、可更新并拒绝非字符串数组 |
| `packages/client/ui-sidebar/tests/{apply,panel-list,sidebar-snapshot}.client.spec.*` | 在测试组合中提供配置表单，覆盖实际插件加载路径 |
| `packages/client/ui-conversation/tests/{apply-wiring,apply-inject,assembly-surfaces,submission-policy}.client.spec.*` | 更新已有设置 fixture 以包含新字段，并验证组件通过同一配置表单写入 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/client/ui-sidebar/tests \
  packages/client/ui-conversation/tests/view-pins.client.spec.ts \
  packages/client/ui-conversation/tests/config.host.spec.ts \
  packages/client/ui-conversation/tests/apply-wiring.client.spec.tsx --maxWorkers=2
  Test Files  13 passed (13)
  Tests  157 passed (157)

DSH_GATE_CONCURRENCY=2 NODE_OPTIONS=--max-old-space-size=4096 pnpm run build
  10 passed, 0 failed, 0 skipped

DSH_GATE_CONCURRENCY=1 NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped

pnpm exec oxlint packages/client/ui-sidebar/src packages/client/ui-sidebar/tests \
  packages/client/ui-conversation/src/client/view-pins.ts \
  packages/client/ui-conversation/tests/view-pins.client.spec.ts
  exit 0
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)
<!-- ai-declaration:end -->

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | The Agent selected #14245 from the standing queue, confirmed the two in-memory pin lists from source and README, checked for an existing PR or fork branch, and chose the existing Host-backed settings pattern. |
| design 方案设计 | auto 模型自主 | 90% | The Agent designed one shared pattern for both plugins: volatile list fields, ConfigForm adoption, buffered pre-load choices, optimistic in-flight writes, and rollback on refusal. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent defined and ran the focused behavior matrix, including real Host Settings persistence and profile restart; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent implemented both package changes, the tests, bilingual README updates, translation records, commit, and push. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
