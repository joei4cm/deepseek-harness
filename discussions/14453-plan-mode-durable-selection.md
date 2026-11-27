<!--
Status: draft, not published.
Target: Discussion #14453.
Do not publish without explicit user authorization and a fresh check for new comments.
-->

# English reply (draft)

We took a look at this on current `master` (`4b399c39a6`) and traced the restored session's log.

What the restore already does: when the client restores a session, the agent-loop's resume path runs the crash repair (`interruptedTurnClosers`), so the interrupted turn is closed with synthetic `step/end` and `turn/end` events. After that the turn-boundary fold reports no open turn, so a `/plan off` issued after the restore commits `plan/mode{active:false}` at once, appends the user-switch notice, and the `plan:status` section reports "Plan mode is inactive. The plan-mode instructions no longer apply." We reproduced this with a real JSONL session and a real resume.

What did not survive a restart: a selection made while a turn was open. `/plan` and `/plan off` issued during a turn wait for the next accepted in-turn pre-step before they are appended, and that wait was held only in the process's memory. The command lifecycle had already recorded the selection in the session log, and the `plan` projection reported it as pending, but after a restart the runtime no longer had it: the restored session dropped the selection while the projection still said it was outstanding. The controller now rehydrates the pending selection from that durable record, so a restored session applies it at its next accepted in-turn pre-step, and cancelling it clears the record.

The fix is on our fork as `fix/plan-mode-durable-selection` (`ecc9ee61c97f1068b481660b9025ff92c2bb4917`). Upstream does not accept external pull requests, so the branch carries no CI result. Validation: the plan-mode suite passes (4 files / 88 tests) with 100% statement, branch, function, and line coverage of the package source; the new cases fail against `master`'s source; host typecheck, lint, the documentation gates, and the recorded plan-review snapshot pass.

One part of the report we could not reproduce as a state gap: after the restore the model is told that plan mode is inactive. The recorded prompt (`snapshots/sdk/plan-review/system-prompt.expected.md`) shows `plan:status` flipping to "Plan mode is inactive. The plan-mode instructions no longer apply.", while the `plan:policy` guidance stays in the context by design — the policy remains registered after exit so the prompt prefix stays stable. If the agent keeps planning after `/plan off`, it is not following that status line. Retiring the policy section when plan mode is left would change that recorded prompt protocol, so we did not change it in this branch.

We did not reproduce the `exit_plan_mode` tool failure that started your sequence, and it is not needed for the state gap above. The approved review's pending exit is still process-local, as the package README documents, and we left it that way.

# 中文对照（仅供阅读，不发布）

我们对照当前 `master`（`4b399c39a6`）核对了这个现象，并跟踪了恢复后会话的日志。

恢复流程已经做到的部分：客户端恢复会话时，agent-loop 的 resume 路径会执行崩溃修复（`interruptedTurnClosers`），用合成的 `step/end` 与 `turn/end` 关闭被中断的轮次。此后轮次边界折叠不再有开启的轮次，因此恢复后执行的 `/plan off` 会立即提交 `plan/mode{active:false}`，追加用户切换通知，`plan:status` 段落也报告「Plan mode is inactive. The plan-mode instructions no longer apply.」。我们用真实的 JSONL 会话和真实的恢复流程复现过这一点。

没有跨重启保留的部分：在轮次开启期间做出的选择。轮次中执行的 `/plan` 与 `/plan off` 会等到下一个被接受的轮内 pre-step 才被追加，而这段等待此前只保存在进程内存里。命令生命周期已经把这次选择记进会话日志，`plan` 投影也报告它待生效，但进程重启后运行时手里已经没有它：恢复出的会话丢掉了这次选择，而投影仍说它未结算。现在控制器会从这份持久记录里取回待生效选择，恢复出的会话会在它下一个被接受的轮内 pre-step 应用它；取消这次选择时也会一并清除该记录。

修复在我们的 fork 分支 `fix/plan-mode-durable-selection`（`ecc9ee61c97f1068b481660b9025ff92c2bb4917`）上。上游不接受外部 PR，因此该分支没有 CI 结果。验证：plan-mode 测试全绿（4 个文件 / 88 个测试），包源文件的语句、分支、函数、行覆盖率均为 100%；新增用例在 `master` 的源码下失败；host typecheck、lint、文档门禁与已录制的 plan-review 快照均通过。

报告中有一处我们没能复现为状态问题：恢复之后模型会被告知计划模式已不生效。已录制的提示词（`snapshots/sdk/plan-review/system-prompt.expected.md`）显示 `plan:status` 翻转为「Plan mode is inactive. The plan-mode instructions no longer apply.」，而 `plan:policy` 引导按设计仍留在上下文里——退出后策略依旧注册，以保持提示词前缀稳定。如果 `/plan off` 之后 agent 仍在规划，那它没有遵守这条状态说明。在离开计划模式时注销策略段落会改变已录制的提示词协议，因此本次分支没有改动它。

我们没有复现出引发这串现象的 `exit_plan_mode` 工具失败，而且上面这个状态缺口也不需要它。评审通过后的待生效退出仍然只存在于进程内，正如包 README 所记录的那样，本次没有改变这一点。
