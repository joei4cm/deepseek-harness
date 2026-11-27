## Motivation

计划模式在轮次开启期间做出的选择会排队到下一个被接受的轮内 pre-step 才写入日志，而这次排队此前只保存在进程内存里：`/plan` 命令的生命周期已经把选择记进会话日志，运行时却只读内存条目，进程在追加之前退出就会丢掉这次选择——投影仍然报告「待生效」，恢复出的会话却不再应用它，运行时与界面因此不一致（Discussion #14453；#857 的第 1 条记录了同一缺陷）。

## Changes

**Interface changes**: None.

**Behavior changes**:

- 恢复出的会话从 `plan` 投影的持久记录里取回待生效选择：日志中一条成功的 `/plan` 命令，其目标与已记录模式不同、且其后没有 `plan/mode` 时，这次选择会在下一个被接受的轮内 pre-step 追加并生效，不再随进程退出而丢失。
- `plan:status` 段落报告这份恢复出的选择，因此恢复后的下一次请求与恢复前的请求描述同一状态。
- 取消一次这样的选择会同时清除它的持久记录，之后的恢复不会重新应用它。
- 退出工具已通过评审的待生效退出仍然只存在于进程内，本次改动不改变这一限制。
- 包 README 与 `docs/subsystems/plan.md`（中英双语）记录恢复语义。

**Module responsibilities and dependencies**: None.

## Testing

**Test design**（行为矩阵）：

| 场景 | 变更前 | 变更后 | 覆盖用例 |
|---|---|---|---|
| 轮次开启期间执行 `/plan off` 后进程退出，再恢复会话 | 投影仍报告该选择待生效，运行时不再应用它 | 恢复出的会话在下一个被接受的轮内 pre-step 应用这次选择 | 新增「恢复出的会话」用例 |
| 恢复出的会话里的 `plan:status` 段落 | 仍报告计划模式处于激活状态 | 报告计划模式不再生效 | 新增状态段落用例 |
| 恢复出的会话里再次执行 `/plan off` | 命令被当作「已经是该状态」而丢弃 | 保持待生效，并在下一个 pre-step 应用 | 新增重复退出用例 |
| 恢复出的会话里取消这次待生效选择 | 持久记录仍在，之后的恢复会重新应用它 | 持久记录被清除，之后的恢复不再应用 | 新增取消用例 |
| 没有待生效选择的会话 | 不变 | 不变 | 既有用例 |

**Test entries**：

- 本地 `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run packages/plan/plan-mode/tests --maxWorkers=2 --coverage --coverage.include='packages/plan/plan-mode/src/**/*.ts'`：4 个文件、88 个测试通过，语句、分支、函数、行覆盖率均为 100%。
- 反向对照：把 `packages/plan/plan-mode/src/index.ts` 还原为 `origin/master` 后，5 个新用例中 4 个失败（第 5 个「没有已记录选择的会话保持不变」在两侧都通过）；还原修复后全部通过。
- 反向对照：只移除持久记录的清除逻辑时，新增的取消用例失败——待生效的退出在下一个 pre-step 被重新应用。
- 本地 `pnpm run typecheck`：5 个门禁全部通过。
- 本地 `pnpm run lint`：通过。
- 本地 `pnpm run test:docs`：21 通过、0 失败。
- 本地 `pnpm run doc-sync`：38 通过、5 失败。5 个失败均为本仓库既有问题，与本次改动无关：tool、config、persistence 目录过期，以及 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/guide.md` 仍引用上游已删除的 `packages/experimental/ptc-runtime-python`。
- 本地 `pnpm run test:snapshot snapshots/sdk/sdk.snapshot.ts -t 'plan-review'`：1 通过、46 跳过。
- 推送钩子 typecheck 门禁：5 通过、0 失败。
- 没有 CI 结果：上游不接受外部 PR，因此分支暂存在 fork。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复核上游 Discussion #14453 的复现步骤，验证恢复会话时的崩溃修复会关闭被中断的轮次，并定位到排队中的选择只存在于进程内存。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定从 `plan` 投影的持久记录恢复待生效选择，并让取消动作同时清除该记录。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计恢复、状态段落、重复退出与取消四个场景，覆盖整个 plan-mode 测试目录并跑覆盖率与两组反向对照。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 实现投影恢复与记录清除，补齐中英双语的 README 与子系统文档。 |
| review 评审处理 | n/a 暂不适用 | — | No review comments have been handled. |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
