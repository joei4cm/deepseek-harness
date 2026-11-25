## Motivation

打包桌面端的 Host 进程环境中会带着 `ELECTRON_NO_ASAR`（该变量在启动期的运行时准备阶段出现且不还原，写入方在仓库源码之外）。所有经 `scrubbedParentEnv` 派生的子进程都继承它，而 Windows Job runner 入口位于 `app.asar` 内——失去 asar 解析的 runner 在 IPC 建立前以 `MODULE_NOT_FOUND` 退出码 1 死亡，于是所有依赖子进程的能力（`pwsh`、`glob`/`grep`、后台任务、终端）全部失效，且 runner 自身 stderr 被丢弃使故障零证据。Refs #14317

## Changes

**Interface changes**: None。

**Behavior changes**:
- `scrubbedParentEnv` 额外丢弃 `ELECTRON_NO_ASAR`（大小写不敏感）。`ELECTRON_RUN_AS_NODE` 保留：它是让打包 Electron 二进制按普通 Node 运行的模式开关，经由该模式启动的子进程仍需要它。显式 `spec.env` 条目在 scrub 之后合并，有意转发该变量的调用方不受影响。
- Windows runner 自身的 fd 2 由 `ignore` 改为 `pipe`，父进程保留最多 4 KiB 尾部；runner 在未给出 IPC 结果前异常退出时，`SUBPROCESS_RUNNER_FAILED` 错误信息附带该尾部（如 `Cannot find module ...runner.js`）。`settleRange` 在 stderr 流关闭后才结算失败，保证尾部完整。
- `dsh-subprocess`、`dsh-subprocess-local` 双语 README 更新对应描述。

**Module responsibilities and dependencies**: None（无新增/删除包、无运行时依赖边变化、无职责迁移）。

**Existing test behavior**：`runnerStdio` 的 Windows IPC 分支 fd 2 期望从 `'ignore'` 更新为 `'pipe'`；`windows-job.spec.ts` 的 FakeChild 补 runner stderr 流（fd 2 管道是新行为）。`spawn-runner.spec.ts`/`windows-job.spec.ts` 三处 stdio 断言同步更新。另外 `resolveWindowsExecutable` 的测试调用此前依赖 `process.env` 提供 cwd 搜索策略，ambient `NoDefaultCurrentDirectoryInExePath` 会静默改变探测顺序——全部改为注入显式环境（seam 已支持的第 5 参），仅两处专门测该策略的调用保留 `NODEFAULT` env。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 父环境含 `ELECTRON_NO_ASAR` 时派生 runner bootstrap env | 变量透传 → runner 无法解析 asar 内入口 | 变量被丢弃；`ELECTRON_RUN_AS_NODE` 保留；显式 env 可转发 | `service.spec.ts` 新 scrub 用例 + `spawn-runner.spec.ts` 新 runnerEnvironment 用例 |
| runner 在 IPC 前异常退出且打印了 stderr | `SUBPROCESS_RUNNER_FAILED` 仅报退出状态 | 错误附带有界 stderr 尾部 | `windows-job.spec.ts` 新增 stderr tail 用例 |
| runner 异常退出且无 stderr 输出 | 报退出状态 | 不变 | 同一新用例的 quiet 分支 |
| Windows runner stdio 布局 | fd2=`ignore` | fd2=`pipe` | `spawn-runner.spec.ts`/`windows-job.spec.ts` stdio 断言 |
| target env（`targetEnvironment`）与 Linux 路径 | — | 不变（同闸生效于 childEnv，Linux 无 asar 受影响面但语义一致） | 既有 64+125 用例全绿 |

Windows 端真机验证由 CI 的 `check:windows-wine`/Windows 作业承担；本机为 Linux，runner bootstrap 的 asar 路径是 Windows Desktop 打包形态专属，无法在本机复现端到端故障。

**Test entries**:
- `env -u NoDefaultCurrentDirectoryInExePath pnpm exec vitest run packages/subprocess/subprocess/tests/service.spec.ts packages/subprocess/subprocess-local/tests/windows-job.spec.ts packages/subprocess/subprocess-local/tests/spawn-runner.spec.ts` — 3 文件 64 用例全绿（本机）。`env -u` 仅为本机 ambient `NoDefaultCurrentDirectoryInExePath=1` 干扰既有用例所需——该干扰随后在本分支第二个 commit 中已消除，重跑 `pnpm exec vitest run packages/subprocess/subprocess-local/tests/spawn-runner.spec.ts` 在污染环境下 40 用例全绿（本机）。
- `env -u NoDefaultCurrentDirectoryInExePath pnpm exec vitest run packages/subprocess/subprocess-local/tests/native-windows.spec.ts packages/subprocess/subprocess/tests/egress.spec.ts packages/subprocess/subprocess-local/tests/linux-scope.spec.ts packages/subprocess/subprocess-local/tests/local.spec.ts` — 125 通过、5 跳过（native-windows 为 Windows 专属跳过）。
- 推送时 pre-push typecheck：5 gates 全过（本机，~110s）。
- `pnpm run verify-translation-pairing` — 2 对 README 配对一致（本机）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依讨论线索在源码中定位 scrub 闸与 stderr 丢弃点，确认写入方不在仓库源码内。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 自行选择 scrub 落点（`scrubbedParentEnv` 而非 runner-only）与 stderr 有界尾部方案。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计并运行覆盖矩阵；本机 ambient 变量干扰定位为本机问题。 |
| implementation 技术实现 | auto 模型自主 | 100% | 全部代码、测试、双语 README 由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
