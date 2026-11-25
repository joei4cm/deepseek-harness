## Motivation

Discussion #14276 报告：`dsh 0.2.3-alpha.2` 的 `bash` 工具把大输出**只保留尾部**（工具描述原文 "Long output is truncated to its tail"），在 TraceTrial-Bench 的 C1 任务评估里造成表头/元数据被裁掉、模型只能靠额外恢复轮次吸收（三个 C1 任务的 Harness Score 均因此受损）。从 master 源码证实：

1. `OutputCollector`（subprocess 层）内存中只保留尾部窗口，spill 文件覆盖头部——行内注释明确记载该取舍（"Tail-keep rationale (pi/OpenCode): errors and final results cluster at the end of command output; the spill file covers the head"）。`bash-local` 的模型可见预览就是这个尾部：截断的预览从输出中部开始（报告者的 `LINE=008917` 即此），表头、快照 id、首批失败根因全部不可见。
2. 报告者同时观察到「嵌套双重 spill」（subprocess 先写完整 stdout 的 spill 文件，外层 spill 策略又把已截断的预览再包一层）。**本 PR 只交付其提案 1（head+tail 预览）**；提案 2 是 spill-policy 层的通用设计问题（通用策略如何识别/复用工具已声明的权威完整输出文件），需要维护者层面的设计决策，在 Discussion 回复草稿中单独讨论，不搭本 PR 的车。

设计要点：subprocess spill 文件本就是完整流的恢复物（默认上限 64 MB），所以头部字节直接从 spill 文件读回——**subprocess 层零改动**。这保住了它的承重约束：尾部窗口是后台增量读（`readOutput` 的 consuming 偏移语义）与诊断尾（LSP stderr）的契约；任何「head 窗口进驻收集器」的方案都会在 `total ≤ cap` 区间把字节偷进头部、破坏增量读（实现中被既有后台读测试当场抓住，见 Testing）。

Refs #14276

## Changes

**Interface changes**

- `dsh-bash-local` / `dsh-pwsh-local` 新增 `headBytes` 配置（默认 `2,048`，Volatile）：截断的 stdout 预览保留的头部字节数，0 恢复 tail-only。无其他公开 API 变化；`dsh-subprocess` / `dsh-subprocess-local` 零改动。
- 模型可见文本：`dsh-tool-bash` / `dsh-tool-pwsh` 描述句由 "Long output is truncated to its tail" 改为 "Long output keeps its beginning and end"（与行为一致）。快照已用 `test:snapshot:refresh` 刷新：73 个 expected 文件，全部是纯描述句替换。

**Behavior changes**

- 截断的 stdout 预览 = spill 文件头部 `min(headBytes, ⌊stdoutMaxBytes / 2⌋)` 字节 + 精确省略标记 `\n[… omitted N bytes …]\n` + 内存尾部重裁至 `stdoutMaxBytes − head` 字节。两个窗口互不重叠（尾部按「预算减头」重新裁剪），`N = total − head − tail` 精确。
- 头部窗口最多占该次 stdout 预算的一半：尾部必须保住输出末尾（错误与最终结果聚集处）。头部字节来自 spill 文件的一次有界同步读（结果组装路径，≤ headBytes 字节）。
- 降级路径（全部回到 tail-only，与现状一致）：spill 被丢弃或目录失效（无 spillPath）、spill 文件在结果组装前消失、头部读失败。stderr 恒为 tail-only。后台增量读与 `snapshot()` 语义不变。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-bash-local` | 本地 bash 执行：预算、超时、模型可见 stdout/stderr 合成 | 变更：`finalOutput` 头+尾组合；新增 `headBytes` 配置 |
| `dsh-pwsh-local` | 本地 PowerShell 执行（bash 的 deliberate twin） | 同步相同变更 |
| `dsh-tool-bash` / `dsh-tool-pwsh` | 工具 schema 与结果渲染 | 变更：描述句与 README 行为描述 |
| `dsh-subprocess` / `dsh-subprocess-local` | 有界输出收集与 spill | 无改动（承重约束保留） |

依赖边：无新增或删除。

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 截断 stdout：头（0001–0004）+ 精确标记（150 字节）+ 尾（0035–0050），spill 仍为完整流 | 逐字节断言 | `keeps the stdout head alongside the tail and spills the complete stream`（bash 新增 + pwsh 镜像） |
| 每次 stdout 上限 < 配置头窗口 | 头收缩到预算一半，尾部保持，标记计数精确 | `caps the stdout head at half the per-call budget and keeps the tail`（bash 新增） |
| spill 被丢弃（`maxSpillBytes: 8`） | tail-only 降级，无标记 | `falls back to the tail-only preview when the spill never materializes`（bash + pwsh 镜像） |
| spill 文件在结果组装前被删 | tail-only 降级，仍报告 spillPath | `falls back to the tail-only preview when the spill file disappears before the result`（bash + pwsh 镜像） |
| stderr 截断 | 恒 tail-only，无头窗口 | `keeps stderr tail-only while stdout carries a head window`（bash 新增） |
| `headBytes` 非法（负数/小数） | resolve 时 fail loud | `rejects a fractional or negative headBytes config at the next command`（bash 新增） |
| 截断结果含尾部末行（既有不变式） | 不改一字、新语义下通过 | 既有 `reports truncation with the spill path`（tool-bash） |

pwsh 镜像测试在本机无 pwsh 时跳过（与该包既有 executor 测试同一安排），在 pwsh 就绪的 CI 上覆盖 `pwsh-local/src/index.ts` 的新分支。

**Test entries**

| 文件 | 变化 |
|---|---|
| `packages/shell/bash-local/tests/executor.spec.ts` | 新增 5 例 |
| `packages/shell/pwsh-local/tests/executor.spec.ts` | 新增 3 例（镜像） |
| 既有套件 | 零修改、零删除；快照 expected 73 文件纯描述句替换 |

命令与结果（本地运行）：

```
pnpm exec vitest run --maxWorkers=2 \
  packages/shell/bash-local packages/shell/pwsh-local packages/shell/bash-sandbox \
  packages/shell/tool-bash packages/shell/tool-pwsh packages/subprocess/subprocess-local
  Tests  848 passed | 1 failed (pre-existing) | 53 skipped (902)

pnpm exec oxlint packages/shell/bash-local packages/shell/pwsh-local \
  packages/shell/tool-bash packages/shell/tool-pwsh packages/subprocess/subprocess-local
  exit 0

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped

pnpm run duplication
  Found 0 clones.
```

既有失败说明：`subprocess-local/tests/spawn-runner.spec.ts` 的 Windows 语义用例（`resolves Windows executables with target-cwd and PATH search semantics`）在本机干净 master（未含本 PR 改动，subprocess 层零改动）上同样失败，属环境既有，与本 PR 无关。

红绿证据：先把 `finalOutput` 的组合分支短路为 tail-only 复跑——2 个组合断言测试红（两个降级测试设计免疫、保持绿）；恢复实现后 41 全绿。设计中途的错误也被既有测试当场钉住：第一版把 head 窗口放进 subprocess 收集器，后台 consuming 读的增量字节被头部窗口吞掉（`start returns a running handle…` 等 6 例红），由此确立「subprocess 层零改动」；第二版让 head 独占 `cap − 1` 之外的全部预算，既有 `reports truncation with the spill path`（期望 `line-0100` 在预览内）红，由此确立「头部最多占预算一半」。快照治理：refresh 在 10 个 `writer.expected.jsonl` 里产生的易变字段（时间戳/时长）重放噪声已全部还原、未提交；提交的 73 个文件逐一核对为纯描述句替换，`pnpm run test:snapshot` 复放通过。

覆盖率说明：`bash-local/src/index.ts` 仅以本包套件运行时为 87.67%（master 基线 85.60%，同一非覆盖区域——后台执行路径 279–295 ↔ 基线 232–248，由聚合 lane 其他包的套件提供，与本 PR 无关）；本 PR 新增行全部被本包套件覆盖。`pwsh-local` 新分支由 pwsh 就绪环境的 CI 覆盖。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)
<!-- ai-declaration:end -->

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent scanned the day's Discussions, ranked candidates (Windows/HarmonyOS-specific reports were not verifiable on this Linux machine), confirmed #14276 from source (tail-only preview at the subprocess layer, spill file covering the head), ran the three-way duplication check, and chose proposal 1 over the spill-policy redesign; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent placed the head-and-tail composition in the executors' `finalOutput` (reading head bytes from the spill file) after a first design that moved a head window into the subprocess collector broke the incremental background reads — keeping the subprocess layer untouched preserves its tail-window contract; the half-budget rule came from an existing test that pinned tail visibility. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent wrote byte-exact composition tests plus deterministic degrade-path tests (discarded spill; spill file deleted mid-run), mirrored three into the pwsh suite for pwsh-equipped CI, verified red with the composition short-circuited, refreshed the model-visible snapshots, reverted the volatile-field replay noise the refresh produced in ten writer fixtures, and re-verified replay; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent implemented the executor-side composition with bounded synchronous spill reads, added the `headBytes` config with loud validation, updated the pinned tool descriptions and bilingual docs, and regenerated the config and tool catalogs. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
