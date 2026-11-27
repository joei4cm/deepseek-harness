## Motivation

打包版 Desktop（macOS，0.2.2-rc.5）空闲时 Host 进程占满一个核：`client-hmr` 每 500 ms 对全部 113 个 client bundle 做 `statSync`，而这些 bundle 全部位于 `app.asar` 内部，asar 的 stat 每次都要重读归档索引（Discussion #14454；报告者的 A/B 实验证明禁用 client-hmr 后 CPU 114%→2%）。

归档内部文件在进程生命周期内不可变，这些监听永远不可能触发——轮询是纯开销。

## Changes

**Interface changes**: None（`pollIntervalMs` 配置语义不变）。

**Behavior changes**:

- 在 Electron 运行时（主进程 `process.versions.electron`，或 `ELECTRON_RUN_AS_NODE=1` 的子进程如 Desktop Host）下，`syncWatches` 不再为路径含 `.asar/` 段的 bundle 建立监听，因此 `pollWatches` 不再对其 `statSync`。打包 Desktop 的全部 bundle 位于 `app.asar` 内 → 轮询开销归零；`app.asar.unpacked` 真实文件不匹配该模式，照常监听。
- 纯 Node 部署（`dsh web`、开发构建）行为完全不变：即使目录名碰巧含 `.asar` 也照常监听。
- `pluginEvents` Remote 流、图增量、`rebuilt` 发布路径均不变；asar 内 bundle 本就不可能重建，没有可丢失的通知。
- `packages/client/hmr` README 中英对照补充该豁免说明。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**（行为矩阵）：

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| Electron 运行时 + bundle 在 `app.asar/` 内 | 每 500ms statSync，CPU ~100% | 不建立监听，零 stat | 新用例（`ELECTRON_RUN_AS_NODE=1` stub + `process.versions.electron` Reflect 注入各一）：写入文件无 `rebuilt` 上报，同图普通路径行仍正常上报 |
| Electron 运行时 + 普通路径 bundle | 正常监听 | 不变 | 同上用例的 `pkg-plain` 行断言照常触发 |
| 纯 Node + `.asar` 命名目录 | 正常监听 | 不变（视为普通目录） | 新用例：无 Electron 信号时 `.asar/` 路径照常触发 `rebuilt` |
| 既有 watch/graph/dispose 行为 | — | 不变 | 既有 6 用例全部通过 |

**Test entries**:

- 本机 `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run packages/client/hmr/tests --maxWorkers=2`：3 文件 / 17 用例全部通过。
- 同命令加 `--coverage --coverage.include='packages/client/hmr/src/**/*.ts'`：语句/分支/函数/行全 100%。
- 负控：`src/index.ts` 还原为 `origin/master` 后，「does not stat-poll bundles inside an Electron asar archive」失败（asar 行被监听并上报），恢复修复后通过。
- 本机 `pnpm exec tsc -b tsconfig.host.json`、`pnpm run lint:contracts-ready`、`verify-translation-pairing`、推送钩子 typecheck（5 门禁）通过。
- 未在打包 Electron 环境实测（需 macOS 打包产物；报告者的 asar A/B 与本机 Node 层机制验证已覆盖机理）。上游不接受外部 PR，分支暂存于 fork，无 CI 结果。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 通读 #14454 全部证据（top/sample/inspector 调用栈、A/B 禁用实验），定位到 `pollWatches`→`bundleStat`→`statSync` 的 500ms 全量轮询。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择在 `syncWatches` 按「Electron 运行时 × .asar 路径」豁免监听，而非放慢轮询或加开关——归档不可变使监听必然空转；评估并放弃了 config 方案与按连接数跳过方案。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 新增 3 用例（env stub、Reflect 注入 versions、纯 Node 对照）、负控、覆盖率与 lint/typecheck。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写 index.ts 豁免、测试、README 中英段落与本描述。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
