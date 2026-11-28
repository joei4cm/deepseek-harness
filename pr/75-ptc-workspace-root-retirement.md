## Motivation

上游 Discussion #14495 报告：`0.2.3-alpha.1` 起（PR #7820 让 `workspaceRoot` 跟随当前工作区后），同一 PTC 会话里 `enter_worktree` 成功返回，下一条 `run_code` 在执行任何代码前即以 `PTC_RUNTIME_CONFLICT`（"persistent PTC: release the retained environment before changing its sandbox policy"）失败——清理监听器只处理 `sandbox/mode`，不处理 `workspace-root/change`，旧进程不退出，重试持续撞上同一检查。`0.2.3-alpha.3` 仍可复现。

Refs #14495

## Changes

**Interface changes**:

没有新增或删除事件、失败码、配置项或导出；`dsh-ptc-runtime-node` 新增 peer 依赖 `@deepseek-ai/dsh-working-directory`（仅类型层，用于读取 `workspace-root/change` 事件类型，与其他观察该事件的包一致）；`PolicyProcesses.register` 新增第三个可选参数 `settled`，该类由 `dsh-ptc-runtime-node` 内部使用，不从包根导出。

**Behavior changes**:

- `workspace-root/change` 提交后，以不同根目录启动的持久化 PTC 进程被淘汰：若进程正在执行，等本次求值结算后再释放（发起移动的那条程序保持自己的结果，不被中止）；空闲进程立即释放。非持久化的按调用准入不受影响。
- 下一条 `run_code` 的准入等待该清理完成后，才在新根目录下启动全新进程（旧 REPL 变量与旧目录授权不保留）；等待期间工作区再次变化时，新产生的根目录淘汰也在同一准入中等待。清理失败则该次调用失败且可重试，与模式变化的既有语义一致。准入不等待等待期间新出现的模式失效——那可能正是本次准入自身的取消（其 release 等待本次准入完成），否则会死锁；模式失效沿用原有的单批快照语义。
- `sandbox/mode` 语义不变：仍立即取消执行中的求值；若某进程已有延迟淘汰在等待结算，模式变化会把它升级为立即释放。
- `run_code` 入口先校验 Session 目录（可能提交恢复性的 `workspace-root/change`），再读取常驻沙箱策略，使恢复后的策略携带新根目录。
- 两个包的 README 双语段落补充上述行为。

**Module responsibilities and dependencies**:

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-ptc-runtime-node` | Node 侧 PTC 执行与保留进程的生命周期：进程失效、清理与准入等待 | 变化：除 `sandbox/mode` 外也观察 `workspace-root/change`，在当前求值结算后淘汰以旧根目录启动的保留进程，并在下一次准入前等待该淘汰 |
| `dsh-tool-registry-ptc` | `run_code` 工具入口：参数校验、沙箱策略解析与程序调度 | 变化：入口先校验 Session 目录再读取常驻策略，使校验期间提交的目录恢复成为程序实际运行的根目录 |
| `dsh-working-directory` | Session 工作目录的拥有者，记录并投影 `workspace-root/change` | 不变，作为新增依赖的目标：其事件类型是根目录变化的唯一权威来源 |

依赖边：

- 新增 `dsh-ptc-runtime-node → dsh-working-directory`（peer；源码中只有 `import type {}` 的类型层引用）
- 反向边：无。`dsh-working-directory` 的运行时依赖不含 `dsh-ptc-runtime-node`，本次新增的边也没有反向边。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 持久化求值执行中提交 `workspace-root/change`（报告的 `enter_worktree` 场景，runtime 层复刻） | 移动求值完成后旧进程不退出；下一条 `run_code` 以 `PTC_RUNTIME_CONFLICT` 拒绝（负对照已复现同文错误） | 移动求值正常返回自身结果；旧进程退出；下一条 `run_code` 在新根目录以空环境运行，`typeof retained` 为 `undefined`；新目录可写、旧目录写入被拒 | `persistent-sandbox.spec.ts`：`retires the retained process after a workspace move and admits the next program under the new root`（两种 REPL 求值器各一例，真实子进程） |
| 根目录变化时进程空闲 | 不淘汰 | 立即释放 | `policy-processes.spec.ts`：`retires a retained process after its evaluation settles …`（`settled` 已决时立即路径） |
| 根目录未变（同根事件）/ 非持久化准入 | — | 不淘汰、不取消 | `policy-processes.spec.ts`：同根事件不释放；`leaves a per-call admission running …` |
| 延迟淘汰等待中模式变化 | — | 升级为立即释放 | `policy-processes.spec.ts`：`escalates a deferred root retirement to immediate release …` |
| 等待清理期间工作区再次变化 | — | 同一准入内继续等待新淘汰 | `policy-processes.spec.ts`：`awaits a retirement that starts while an earlier one is pending` |
| 清理失败重试（既有语义） | 失败后可重试 | 不变 | 既有 `retries failed cleanup …`（仍通过） |
| 等待清理期间模式变化（既有语义） | 该调用保持取消（不因模式切回而复跑） | 不变 | 既有 `persistent-host.spec.ts`：`keeps a … call canceled when policy changes back during earlier cleanup`（3 种模式；曾因等待循环死锁而失败，修正后通过） |

**Test entries**（全部为本地运行，基于上游 `master` `841f76d3c5`）:

- 负对照：三个源文件（`policy-processes.ts`、`worker.ts`、`tool-registry-ptc/src/ptc.ts`）还原为 `master` 后，集成测试在两种求值器下均以 `PtcRuntimeError: persistent PTC: release the retained environment before changing its sandbox policy` 失败；单元测试中"结算后淘汰"用例失败（未释放）。
- 定向：`pnpm exec vitest run …/policy-processes.spec.ts …/persistent-sandbox.spec.ts --maxWorkers=2`：2 个文件 39 个测试通过。
- 包级：`pnpm exec vitest run packages/core/tool-registry-ptc packages/ptc-runtime/ptc-runtime-node --maxWorkers=2`：1443 个测试通过、2 个跳过、1 个失败。唯一失败是 `runtime.spec.ts` 的 `cancels a live program and closes its managed process with {"timeoutMs":null}`（`expect.poll` 默认 1000ms 超时）；同一失败在 `master` 源码（未含本 PR 改动）上复现，属本机既有 flake，不归本 PR。
- 覆盖率：`pnpm exec vitest run …/policy-processes.spec.ts …/persistent-sandbox.spec.ts …/persistent-host.spec.ts …/persistent.spec.ts --maxWorkers=2 --coverage --coverage.include='…/src/policy-processes.ts' --coverage.include='…/src/worker.ts'`：304 个测试通过，改动两个源文件的语句/分支/函数/行覆盖率均为 100%。

<details><summary>Proof</summary>

```
# 负对照（master 源码）
PtcRuntimeError: persistent PTC: release the retained environment before changing its sandbox policy
 Tests  2 failed | 28 skipped   # persistent-sandbox -t 'workspace move'

# 修复后（定向）
$ pnpm exec vitest run packages/ptc-runtime/ptc-runtime-node/tests/persistent-sandbox.spec.ts \
    packages/ptc-runtime/ptc-runtime-node/tests/policy-processes.spec.ts --maxWorkers=2
 Test Files  2 passed (2)
      Tests  39 passed (39)

# 修复后（包级）
$ pnpm exec vitest run packages/core/tool-registry-ptc packages/ptc-runtime/ptc-runtime-node --maxWorkers=2
 Test Files  1 failed | 33 passed (34)
      Tests  1 failed | 1443 passed | 2 skipped (1446)
  唯一失败：runtime.spec.ts 的 expect.poll 超时，master 源码上同样失败

# 修复后（覆盖率）
$ pnpm exec vitest run …/policy-processes.spec.ts …/persistent-sandbox.spec.ts \
    …/persistent-host.spec.ts …/persistent.spec.ts --maxWorkers=2 \
    --coverage --coverage.include='…/src/policy-processes.ts' --coverage.include='…/src/worker.ts'
 Test Files  4 passed (4)
      Tests  304 passed (304)
 Statements   : 100% ( 65/65 )
 Branches     : 100% ( 40/40 )
 Functions    : 100% ( 21/21 )
 Lines        : 100% ( 45/45 )
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 90% | 报告者已给出根因与验证思路；Agent 在 master 上独立确认监听器缺口与准入顺序 |
| design 方案设计 | auto 模型自主 | 90% | Agent 采纳报告者时序（结算后淘汰、准入等待），落地为 `settled` 协调 + `retire` 承诺链，并保留模式变化的立即取消语义 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 编写单元/集成测试与负对照，负对照复现报告原文错误 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 完成两个包的源码、测试与 README 双语改动 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
