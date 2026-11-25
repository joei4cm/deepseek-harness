## Motivation

工作区选择与启动恢复竞争时可能取消用户的选择，而尚未同步的空白会话会在再次选择时被重复创建；启动恢复失败也可能在每次列表更新时反复重试。

Refs #14300

## Changes

**Interface changes**

无。

**Behavior changes**

- 列表尚未同步时，工作区连接会优先向 Host 指明最近成功连接的兼容空白会话；Host 继续验证复用条件。
- 列表加载期间的显式工作区选择优先于启动恢复，避免恢复抢占用户正在进行的选择。
- 启动恢复失败后停止自动重试；显式工作区选择失败继续使用已有提示。
- 不同 preset 的并发连接按最新请求保存复用候选，较早请求迟到的结果不会覆盖它。
- 更新生成的 Cordis 客户端 API 目录，保持接口说明与源码一致。

**Module responsibilities and dependencies**

无。

**GUI disclosure**

本改动影响工作区导航行为。尚未嵌入真实应用演示 GIF：当前 `gh` 版本为 2.86，低于附件工作流要求的 2.99，且尚未录制真实服务器演示。

## Testing

**Test design**

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 空白会话已创建，工作区列表未同步 | 下一次连接可能再次创建 | 请求刚创建的兼容会话 | `reuses a superseded creation before the catalogs include its workspace membership` |
| 两个不同 preset 的连接倒序完成 | 没有复用记录 | 保留最新请求结果 | `keeps the latest connection when an older preset request finishes last` |
| 目录加载期间选择工作区 | 启动恢复可能抢占选择 | 显式选择继续完成 | `does not let startup restoration supersede a Workspace choice made while catalogs load` |
| 启动恢复失败后列表变化 | 自动重试 | 不再因列表变化重试 | `does not retry failed startup blank acquisition on catalog updates`；`reports a failed persisted Session restoration without retrying on catalog updates` |
| 候选已归档、已开始、路径或 preset 不匹配 | 按列表资格判定 | 不以缓存候选请求复用 | `does not reuse an ineligible recent blank` |

**Existing test behavior**

启动恢复失败后的两项测试改为断言不再因列表变化而重试，以避免反复创建空白会话。

**Test entries**

- 本地 `pnpm exec vitest run packages/client/ui-workspace/tests/workspaces-service.client.spec.ts --maxWorkers=2`：覆盖工作区导航。

  <details><summary>Proof</summary>

  `Test Files 1 passed (1); Tests 112 passed (112)`

  </details>

- 本地 `pnpm exec vitest run packages/api/session-controller/tests/commands-create-fork.host.spec.ts --maxWorkers=2`：覆盖 Host 创建。

  <details><summary>Proof</summary>

  `Test Files 1 passed (1); Tests 13 passed (13)`

  </details>
- 本地 `pnpm exec vitest run packages/client/ui-workspace/tests --maxWorkers=2`：验证工作区完整测试集。

  <details><summary>Proof</summary>

  `Test Files 18 passed (18); Tests 576 passed (576)`

  </details>

- 本地 `pnpm exec vitest run packages/api/session-controller/tests/agent.host.spec.ts --maxWorkers=2`：覆盖 Host 复用。

  <details><summary>Proof</summary>

  `Tests 10 passed (10)`

  </details>

- 本地 `pnpm exec vitest run packages/api/session-controller/tests/session-list-blank.host.spec.ts --maxWorkers=2`：覆盖 Host 空白会话分类。

  <details><summary>Proof</summary>

  `Tests 5 passed (5)`

  </details>

- 本地 `pnpm exec vitest run packages/client/ui-layout/tests/service.client.spec.ts --maxWorkers=2`：覆盖导航取消。

  <details><summary>Proof</summary>

  `Tests 6 passed (6)`

  </details>

- 本地 `pnpm exec vitest run packages/extensions/cordis-client-runner/tests/api-catalog.client.spec.ts --maxWorkers=2` 和 `pnpm run verify-cordis-inspect-catalog`：验证生成目录。

  <details><summary>Proof</summary>

  `Tests 4 passed (4)`；目录检查报告 up to date。

  </details>

- 本地 `pnpm run test:web:built apps/web/tests/blank-writer-reuse.e2e.ts --maxWorkers=2`：通过真实 Web Host 和测试 scaffold 验证空白会话复用与写者竞争；未运行真实模型。

  <details><summary>Proof</summary>

  `Test Files 1 passed (1); Tests 2 passed (2)`

  </details>

- 本地 `DSH_GATE_CONCURRENCY=1 NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync`：完整文档同步。

  <details><summary>Proof</summary>

  `43 passed, 0 failed, 0 skipped`。

  </details>

- 本地 `pnpm run test:gui --maxWorkers=2`：运行客户端和 Host GUI 测试。

  <details><summary>Proof</summary>

  `Test Files 834 passed (834); Tests 14771 passed | 2 skipped (14773)`。

  </details>

- 本地 `pnpm run build`：构建最终提交。

  <details><summary>Proof</summary>

  命令退出码 0。

  </details>

- 本地 `pnpm run test:docs`：检查文档格式和配对。首次 `doc-sync` 为 42 项通过、1 项失败，失败项是 Cordis API 目录过期；已重新生成目录并通过专项新鲜度检查。

  <details><summary>Proof</summary>

  命令退出码 0。

  </details>

- 本地 `pnpm exec oxlint packages/client/ui-workspace/src/client/navigation.ts packages/client/ui-workspace/tests/workspaces-service.client.spec.ts`：检查代码样式。

  <details><summary>Proof</summary>

  命令退出码 0。

  </details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 根据报告定位启动恢复和列表同步竞态。 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择记录最近连接和限制自动恢复重试。 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计并运行并发、资格与恢复测试。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 实现代码和文档修改。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
