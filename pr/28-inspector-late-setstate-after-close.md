## Motivation

Inspector Worker 意外退出后，Host 侧的 Cordis 观察者仍可能有一次已排队的 `setState` 落到已经关闭的 source 上：`HostBridgePublisher.setState` 在关闭后抛 `Error: inspector: Host source is closed`，而同一个类的 `publish` 只是静默丢弃。这个不一致把一次 Inspector 传输层故障放大成 Desktop Host 进程级未捕获异常。Refs #14355

## Changes

**Interface changes**:
- `InspectorStatePublisher` 新增 `isClosed(): boolean`；`InspectorPublisher.publish` 与 `InspectorStatePublisher.setState` 的契约写明「source 关闭后丢弃发布」。`InspectorSourceConnection` 转发该状态。这是实验包的内部接口，无 wire 格式、配置键或持久化格式变化。

**Behavior changes**:
- Host 与 Client 的 source 关闭后，`publish()` 与 `setState()` 一致地丢弃发布，不再抛异常。关闭前的行为不变；关闭本身仍由其所有者报告（Host 侧为 `dsh inspector: Worker stopped unexpectedly`）。
- Cordis 观察者在其 publisher 关闭后停止观察：不再对每次 `internal/plugin`/`internal/status` 通知生成整棵 realm 快照并丢弃结果，观察者的监听器与保留对象随之释放。
- 包 README（英/中双语）写明「关闭的 source 丢弃后续发布」，并把「不自动重启 Worker」这一限制更新为：Worker 意外退出会使当前 Inspector 实例失败并停止其 Cordis 观察，而 Host 继续运行。

**Module responsibilities and dependencies**: None（改动全部落在 `dsh-experimental-inspector` 包内，无新增或删除的包间运行时依赖）。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| source 关闭后调用 `setState` | 抛 `inspector: Host source is closed`（Host 场景下逃逸为进程级未捕获异常） | 静默丢弃，不抛异常 | `closed-source.host.spec.ts` 的 `drops publications that arrive after the source closed` 与 `accepts a state publication on a closed Host source`；`closed-source.client.spec.ts` 的同名用例 |
| source 关闭后调用 `publish` | 静默丢弃 | 不变 | 同上（回归护栏） |
| source 关闭后发生一次 Cordis 变更 | 观察者向已关闭的 source 发布 `setState` → 抛异常 | 观察者停止观察，无发布、无异常 | `keeps a Cordis mutation inert after the source closed` |
| publisher 关闭后的后续 Cordis 变更 | 继续生成快照并丢弃 | 观察保持停止 | `stops Cordis observation once the publisher closes` |

负控：把 `packages/experimental/inspector/src` 还原到改前版本后，同一组用例 5 个中 4 个失败，并复现报告中的未捕获异常（`Error: inspector: Host source is closed`，栈为 `HostBridgePublisher.setState` ← `shared/cordis/publisher.ts` ← `observeCordisTree`）；确认用例确实覆盖该回归。

**Test entries**:
- `pnpm exec vitest run packages/experimental/inspector/tests/closed-source.host.spec.ts packages/experimental/inspector/tests/closed-source.client.spec.ts --maxWorkers=2` — 2 个文件、5 个用例通过（本机）。
- `pnpm exec vitest run packages/experimental/inspector/tests --maxWorkers=2` — Inspector 包 31 个文件、256 个用例通过（本机）。
- `pnpm run typecheck` — 通过（本机）。
- 推送时的 pre-push typecheck：5 个 gate 全过（本机，~88s）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据上游报告在源码定位到 `publish` 与 `setState` 的关闭态不一致，以及观察者未随 source 关闭而停止。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择「关闭后丢弃发布 + 观察者随 publisher 关闭而停止」，而非引入新的错误类型或改写 Worker 生命周期。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计关闭态行为矩阵并以负控验证用例覆盖该回归。 |
| implementation 技术实现 | auto 模型自主 | 100% | 代码与 spec 由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
