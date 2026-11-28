# #14495 — PTC workspace-root retirement (draft, unpublished)

Status: the one-line takeover claim was denied by the permission classifier (needs explicit user authorization for #14495). This reply is an unpublished draft.

## English

Confirmed on current `master` (`841f76d3c5`): the process-reuse check rejects the retained environment, and `PolicyProcesses`'s cleanup listener handles only `sandbox/mode`, so nothing retires the old process after `workspace-root/change`. We implemented the retirement exactly on the timeline you proposed, as branch `fix/ptc-workspace-root-retirement`:

- `PolicyProcesses` now also observes `workspace-root/change`. A retained process launched under a different root is retired **after the current evaluation settles** — the program that moved the root keeps its own result and is never aborted. Idle processes release at once.
- The next admission (`NodePtcRuntime.run`'s existing `processes.wait`) waits for that retirement before starting a fresh process under the new root; a root move that starts while an earlier retirement is pending is awaited in the same admission, and a failed cleanup keeps the call failing-and-retryable, matching the mode-change semantics. One deliberate boundary: an admission does not wait for a mode invalidation that appears while it waits — that can be the admission's own cancellation, whose release awaits the admission's completion, so mode invalidations keep the existing single-batch semantics.
- `sandbox/mode` keeps its exact semantics: immediate cancellation. A pending deferred retirement escalates to immediate release on a mode change.
- In `tool-registry-ptc`, the entry now validates the Session directory before reading the standing policy, so a recovery committed during validation (your admission note) is the root the program runs under.

Negative control: with the three source files reverted to `master`, the regression test fails with your exact error (`persistent PTC: release the retained environment before changing its sandbox policy`); after the fix, the moving call returns its value, the old process exits, and the next `run_code` starts a fresh environment in the new root (old variables gone, new root writable, old root denied under `workspace-write`). Not taken: your suggestion to clear old REPL variables but keep the process — the release-and-recreate shape is what the existing mode-change path already does, and it is what keeps launch-time directory grants honest.

## 中文

已在当前 `master`（`841f76d3c5`）确认：进程复用检查拒绝保留环境，而 `PolicyProcesses` 的清理监听器只处理 `sandbox/mode`，`workspace-root/change` 后无人淘汰旧进程。我们按你提出的时序在分支 `fix/ptc-workspace-root-retirement` 上实现了淘汰：

- `PolicyProcesses` 现在同时观察 `workspace-root/change`。以不同根目录启动的持久化进程在**当前求值结算后**淘汰——发起移动的程序保留自身结果，绝不被中止；空闲进程立即释放。
- 下一次准入（`NodePtcRuntime.run` 既有的 `processes.wait`）等待该淘汰完成后，才在新根目录下启动全新进程；等待期间再次移动工作区产生的淘汰也在同一次准入中等待；清理失败保持“失败且可重试”，与模式变化语义一致。一个有意的边界：准入不等待等待期间新出现的模式失效——那可能正是本次准入自身的取消（其 release 等待准入完成），模式失效沿用原有单批语义。
- `sandbox/mode` 语义不变：仍然立即取消。已有延迟淘汰在等待结算时，模式变化会将其升级为立即释放。
- `tool-registry-ptc` 入口先校验 Session 目录再读取常驻策略（你的准入说明），使校验期间提交的恢复成为程序实际运行的根目录。

负对照：三个源文件还原到 `master` 后，回归测试以你的原始错误失败（`persistent PTC: release the retained environment before changing its sandbox policy`）；修复后，移动调用返回自身值、旧进程退出、下一条 `run_code` 在新根目录以全新环境启动（旧变量消失，新目录可写，`workspace-write` 下旧目录写入被拒）。未采纳：保留进程只清空旧 REPL 变量的做法——释放并重建正是既有模式变化路径的行为，也是让启动时目录授权保持诚实的方式。
