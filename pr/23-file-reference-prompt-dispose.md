## Motivation

`dsh-file-reference-local` 在每次 agent 销毁时向 Host 日志抛 `agent/disposed listener threw: TypeError: Cannot read properties of undefined (reading 'catch')`：打包的 Cordis 版本中 `fiber.dispose()` 可能返回 `void`，而代码直接对其返回值调用 `.catch`。该告警掩盖真实的销毁监听器失败，且清理记账未登记，使被拒绝的 teardown 成为未处理拒绝。

Refs #14314

## Changes

**Interface changes**

无。

**Behavior changes**

- `disposePrompt()` 把 `fiber.dispose()` 包进 `Promise.resolve().then(...)`：非 Promise 返回值与同步抛出都进入既有的 `logger.warn` 路径，不再让 `agent/disposed` 监听器抛错。
- 无行为差异于 Promise 返回的 Cordis 构建：teardown 记账与警告语义不变。

**Module responsibilities and dependencies**

无。

## Testing

**Test design**

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| `fiber.dispose()` 返回 `void` | `.catch` 抛 TypeError，`agent/disposed` 监听器失败 | teardown 正常登记，无告警 | `tolerates a fiber dispose that returns void instead of a Promise` |
| `fiber.dispose()` 返回拒绝的 Promise（含非 Error 值） | 记 `prompt cleanup failed` 警告 | 行为不变 | `logs rejected prompt cleanup without failing service teardown`（既有） |

负向控制：还原修复后新测试恰好以 1 failed / 7 passed 失败，确认其覆盖该回归。

**Test entries**

- 本地 `pnpm exec vitest run packages/context/file-reference-local/tests/service.spec.ts`：覆盖修复与既有 teardown 语义。

  <details><summary>Proof</summary>

  `Test Files 1 passed (1); Tests 8 passed (8)`

  </details>

- 本地 `pnpm exec vitest run packages/context/file-reference-local`：覆盖所属包全部测试。

  <details><summary>Proof</summary>

  `Test Files 2 passed (2); Tests 21 passed (21)`

  </details>

- 本地 `pnpm run lint` 与 `pnpm exec tsc -p tsconfig.host.json --noEmit`（最终代码树）：代码样式与 Host 聚合类型检查。

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
| breakdown 问题拆解 | auto 模型自主 | 95% | 作者常设授权 Agent 自选候选；Agent 三路查重后选定 Discussion #14314 并核实调用链。 |
| design 方案设计 | auto 模型自主 | 90% | 沿用报告者建议的包装思路；Agent 改为包调用本身以同时覆盖同步抛出。 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计回归用例并做负向控制验证。 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 编写全部改动。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |
