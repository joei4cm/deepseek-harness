<!--
状态：草稿，未发布。
用途：Discussion #14401 的回复正文，供作者过目后决定是否发布。
说明：本回复覆盖「归档会话不释放 persistent PTC 运行时进程」这半条——归档不卸载 Agent，因此 `dsh-tool-executor-ptc` 挂在 Agent 上的保留环境释放点永远不触发。报告者提出的第二条修法（`idleMs` 空闲回收）属于配置与策略决定，本 PR 不处理。
-->

# English reply

Thanks for the precise mechanism analysis — it matches what we found: the only automatic release is the `agent.ctx.effect(() => () => runtime.release(agent))` that `dsh-tool-executor-ptc` attaches to the Agent, so archiving a Session without unloading its Agent leaves the retained runtime process alive. The four `workspace/session-stop` providers you listed never included a runtime-environment family, exactly as you wrote.

On `fix/ptc-release-on-archive` we changed that seam:

- The PTC executor now installs an archive listener in the Agent's own scope, so it lives exactly as long as the environment it ends. When the Workspace registry archives a Session, the listener cancels that Session's running programs first and then ends every environment the Agent retained.
- The release goes through the executor's existing reset coordination, so an in-flight program is cancelled and awaited before the environment is terminated. It queues no model-visible notice: the archived Session is hidden, so nothing observes the lost variables. Unarchiving does not restore the environment — the next program starts from empty memory, which the runtime's existing guidance already covers ("recreate missing variables and resources").
- A release that fails is reported in the host log and does not undo the archive; that Session's programs stay blocked until a later release succeeds, matching the existing reset semantics.
- The Node runtime README's list of what clears retained memory now names Session archival alongside restart, Agent disposal, provider unload, protocol failure and process exit, so the retention contract reads the same from both sides.

Verified with a new composition test that mounts the real `WorkspaceRegistry` beside the real `PtcExecutor` — `ctx.workspaceRegistry.archiveSession(sessionId)` is the shipped archive flow and the shipped event dispatch — covering: the environment ends with the archived Session, a running program is cancelled before the release, another Session's archive leaves it untouched, and a failed release is reported without undoing the archive. Without the patch, three of the four new cases fail (`expected [] to have a length of 1 but got +0`); with it, the package's 5 files / 234 tests pass and the new module is at 100% coverage.

We did not implement your second option (a persistent-PTC `idleMs` reclaim covering sessions that stay open but go unused). That is a configuration and policy decision — the default, whether it is on at all, and how it interacts with an active-but-idle session belong to the maintainers — so we left it out rather than pick a default on your behalf. Your plugin-side collector remains the workaround for that half until the configuration lands.

# 中文对照

感谢精确的机制分析——与我们的排查一致：唯一的自动释放点是 `dsh-tool-executor-ptc` 挂在 Agent 上的 `agent.ctx.effect(() => () => runtime.release(agent))`，因此归档会话但不卸载它的 Agent，保留的运行时进程就会一直存活。你列出的四个 `workspace/session-stop` 提供方确实没有「运行时环境」这一类。

我们在 `fix/ptc-release-on-archive` 改了这一处接缝：

- PTC 执行器现在在 Agent 自己的作用域内安装归档监听器，因此它的生命周期与它结束的环境一致。Workspace 注册表归档会话时，监听器先取消该会话正在运行的程序，再结束该 Agent 保留的每个环境。
- 释放走执行器既有的重置协调，因此先取消并等待在跑的程序结算，再终止环境。释放不排入模型可见的通知：归档后的会话已被隐藏，没有观察者。取消归档不会恢复环境——下一个程序从空内存开始，运行时既有的说明已经覆盖这一点（「重新创建缺失变量与资源」）。
- 释放失败会写入宿主日志，且不回滚归档；该会话的程序保持阻塞，直到后续一次释放成功，与既有重置语义一致。
- Node 运行时 README 的「什么会清除保留内存」清单现在把「归档会话」与重启、Agent 销毁、提供方卸载、协议失败、进程退出并列，保留契约在两边读起来一致。

我们用新的组合测试验证：它把真实的 `WorkspaceRegistry` 与真实的 `PtcExecutor` 组合在一起，`ctx.workspaceRegistry.archiveSession(sessionId)` 走的是出厂归档流程与出厂事件派发，覆盖：环境随被归档的会话结束、正在跑的程序在释放前被取消、另一个会话的归档不影响本会话、释放失败会被报告且不回滚归档。未打补丁时 4 条新用例中 3 条失败（`expected [] to have a length of 1 but got +0`）；打补丁后该包 5 个文件 / 234 条用例全部通过，新增模块覆盖率 100%。

我们没有实现你的第二条修法（persistent PTC 的 `idleMs` 空闲回收，覆盖一直没关但长期没人用的会话）。那是配置与策略决定——默认值、是否默认开启，以及它与「在跑但空闲」的会话如何交互，属于维护者的取舍——所以我们没有替你选默认值。在该配置落地之前，你插件侧的回收逻辑仍然是这一半问题的绕行方案。
