## Motivation

Discussion #14277 报告：`dsh 0.2.3-alpha.2` 的 `bash` 工具在被信号杀死时只输出 `[killed by signal: SIGKILL]`，**缺少 POSIX 约定的 `128 + signum` 数值状态**（`SIGKILL` → 137、`SIGTERM` → 143）。评测里四个任务因此受损（`E1-pumpstop-exit-002` 71.4%、`V2-acceptance-verdict-001` 87.5%、`V2-table-audit-002` 87.5%）：模型推理正确，却在登记 `exit_status` 时留空（undetermined），因为文本里根本没有可登记的数字。

从 master 源码证实：

1. 渲染侧 `packages/shell/tool-bash/src/render.ts` 与 `packages/shell/tool-pwsh/src/render.ts`（deliberate twin）在 `result.signal !== null` 时只推入信号名，没有任何状态码。
2. 平台本身已经知道信号号：`os.constants.signals` 给出每个信号的数字（POSIX 上完整，Windows 上给出其已知子集）。仓库里已经有一处消费方做类似的事——`packages/fs/tool-fs-search/src/search-core.ts` 把 `outcome.signal` 写进错误文本——但同样没有算状态码。所以缺的只是「从信号名到 `128 + signum`」这一步换算，不是新信息源。
3. 提案同时提到「结构化退出元数据里也没有这个状态」。结构化侧的事实是：`ShellRunResult.exitCode` 在被信号杀死时为 `null`，`signal` 单列（`packages/shell/shell/src/types.ts` 明确写了 "null = killed by signal / still running"）。模型能读到的只有工具结果文本里的 marker 一处，`exitCode: null` 的语义由 seam 契约钉死；把它改成 `137` 会让「信号死亡」和「普通退出码」在结构化字段上不可区分，且要同步所有执行器与消费者。因此本 PR 只做提案明确要求的 marker 形态，把结构化字段的取舍留给维护者（见 Discussion 回复草稿）。

提案 2（`stdout`/`stderr` 按到达顺序交织）**不在本 PR**：交织要求 stdout 与 stderr 共享同一个底层文件描述符（`stdio: ['ignore', fd, fd]`），那会改变 `dsh-subprocess-local` 的输出收集与后台增量读语义，属于需要维护者共识的架构问题，不适合搭本 PR 的车。该项在 Discussion 回复草稿中单独分析。

Refs #14277

## Changes

**Interface changes**

- `dsh-shell` 新增导出 `signalExitStatus(signal: string): number | undefined`：从信号名恢复 POSIX 约定的 `128 + signum` 状态；平台没有编号的信号名返回 `undefined`。
- 模型可见文本：信号 marker 增加 `(exit code: N)` 注解。
- 无其他公开 API 变化；`ShellRunResult` 形状不变；`dsh-subprocess` / `dsh-subprocess-local` 零改动。

**Behavior changes**

- 被信号杀死时：`[killed by signal: SIGKILL (exit code: 137)]`、`[killed by signal: SIGTERM (exit code: 143)]`、`[killed by signal: SIGINT (exit code: 130)]`。
- 平台无法编号的信号名保持原形态：`[killed by signal: SIGHIPPO]`。这一条是刻意保留的降级路径，不猜测未知信号的号。
- **信号名仍留在 marker 里**，所以「被信号杀死」与「普通 `exit 137`」依旧可区分——这正是提案要求的形状（"Keep the signal name and include the POSIX numeric status"），也保住了 DSH 现有能力。
- 解析侧：宿主 `dsh-shell` 的 `parseExitStatus` 与客户端终端卡片模型里镜像的解析器，在交出信号名前剥离括号注解。因此终端卡片的 pill 仍显示 `SIGKILL` 而不是数字，退出码 pill 的规则不变；注解只出现在模型可见的文本里。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-shell` | shell 能力接缝定义：请求/规格词汇、结果类型、退出状态 marker 契约 | 变更：新增 `signalExitStatus`；`parseExitStatus` 剥离信号 marker 上的状态注解 |
| `dsh-tool-bash` / `dsh-tool-pwsh` | 模型可见的工具 schema 与结果渲染 | 变更：信号 marker 追加 POSIX 状态注解（pwsh 为 bash 的 deliberate twin，同步改动） |
| `dsh-client-ui-tool` | Web 终端卡片模型（不导入宿主包的镜像解析器） | 变更：镜像解析器剥离状态注解，pill 显示不变 |
| `dsh-subprocess` / `dsh-subprocess-local` | 有界输出收集与 spill | 无改动 |

依赖边：无新增或删除。

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 信号名有平台编号（SIGKILL / SIGTERM / SIGINT / SIGHUP） | 恢复 `137` / `143` / `130` / `129` | `maps POSIX signals to their conventional 128 + signum status`（dsh-shell 新增） |
| 信号名无平台编号 | `undefined`，不猜号 | `returns undefined for a signal name without a platform number`（dsh-shell 新增） |
| 解析带注解的信号 marker | 返回 `signal: 'SIGKILL'`，body 不含 marker | `strips the POSIX exit-code annotation from a signal marker`（dsh-shell 新增） |
| 渲染信号死亡 | marker 带 `(exit code: 143)` | `renders signal kills without the timeout marker when not timed out`、`orders the timeout marker before a kill marker`（tool-bash / tool-pwsh 既有断言更新） |
| 渲染无法编号的信号 | marker 不带注解 | `omits the POSIX exit-code annotation for a signal the platform cannot number`（tool-bash 新增 + pwsh 镜像） |
| 宿主 `presentResult` 解析 | card 仍是 `signal`（pill 显示 `SIGKILL`） | `a non-zero exit and a signal kill parse into exitCode / signal`（tool-bash / tool-pwsh 更新） |
| 客户端终端卡片模型 | pill 显示 `SIGTERM`，不被注解污染 | `derives a settled standard-shell card and removes its final exit marker`、`renders a signal kill as a terminal card`（ui-tool 更新） |
| 后台作业被取消 | marker 形态同步 | `a foreground command stopped from outside the call reports the reason instead of failing`（tool-bash / tool-pwsh 更新） |

**Test entries**

| 文件 | 变化 |
|---|---|
| `packages/shell/shell/tests/render.spec.ts` | 新增 3 例（1 个解析注解 + 2 个 `signalExitStatus`），既有信号断言更新 |
| `packages/shell/tool-bash/tests/tools.spec.ts` | 新增 1 例（无法编号的信号），既有 marker 断言更新 |
| `packages/shell/tool-pwsh/tests/tools.spec.ts` | 镜像新增 1 例 |
| `packages/shell/tool-bash/tests/background.spec.ts`、`packages/shell/tool-pwsh/tests/background.spec.ts` | 既有 marker 断言更新 |
| `packages/client/ui-tool/tests/terminal-card.client.spec.tsx`、`packages/client/ui-tool/tests/spill-policy-terminal.client.spec.ts` | 既有 marker 断言更新 |
| 既有套件 | 零删除；无快照改动（marker 只在信号死亡时出现，快照集不含该形态） |

命令与结果（本地运行）：

```
npx vitest run --maxWorkers=2 \
  packages/shell/shell/tests packages/shell/tool-bash/tests \
  packages/shell/tool-pwsh/tests packages/client/ui-tool/tests
  Test Files  31 passed | 2 skipped (33)
  Tests       834 passed | 7 skipped (841)

npx tsx scripts/run-oxlint.ts packages/shell packages/client/ui-tool
  exit 0

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped
```

红绿证据：把五个实现文件回退到改动前（`git checkout HEAD~1 -- <src files>`）后复跑同一组测试，`16 failed | 818 passed`——红的是全部与信号 marker 形态相关的断言（渲染、宿主解析、客户端卡片、`signalExitStatus` 本身），与本 PR 的断言集合一一对应；恢复实现后 834 全绿。

覆盖率说明：本 PR 新增的分支只有一处——信号名在 `os.constants.signals` 中没有编号时返回 `undefined`——并由 dsh-shell 套件的 `returns undefined for a signal name without a platform number` 覆盖；`dsh-tool-bash` / `dsh-tool-pwsh` 的新增分支同样被各自套件覆盖（pwsh 镜像用例在本机无 pwsh 时跳过，与该包既有 executor 测试同一安排，在 pwsh 就绪的 CI 上覆盖）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)
<!-- ai-declaration:end -->

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent scanned the day's Discussions, confirmed #14277 from source (the renderers push only the signal name; `os.constants.signals` already carries the numbers; `ShellRunResult.exitCode` is `null` for a signal kill by documented contract), ran the three-way duplication check, and chose proposal 1 over the stdout/stderr interleaving change, which needs a subprocess-layer redesign; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent put the `128 + signum` recovery in the shell seam (`signalExitStatus`) so both tools share one implementation, kept the signal name in the marker so a signal death stays distinguishable from a plain exit, and chose to leave `ShellRunResult.exitCode` as `null` because the seam documents that meaning. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent added the mapping and parsing tests, mirrored the render cases into the pwsh suite, updated the existing marker assertions across the host and client suites, and verified red by reverting the five implementation files and re-running the same selection; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent implemented `signalExitStatus`, annotated the bash and pwsh markers, taught both exit-status parsers to strip the annotation, and updated the bilingual package READMEs with the re-recorded translation pairs. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
