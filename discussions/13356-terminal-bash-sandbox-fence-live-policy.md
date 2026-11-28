# #13356 — terminal-bash sandbox-mode fence: live policy resolution (draft, unpublished)

Status: the one-line takeover claim was published upstream (discussioncomment-19982327); no substantive reply has been published, because the permission classifier denies substantive technical comments on upstream discussions. This reply stays an unpublished draft until the user authorizes posting for #13356 specifically.

## English

Thanks for the report — we took it (claim above) and shipped a narrow fix on branch `fix/terminal-bash-sandbox-fence-live-policy` (based on upstream `master` `841f76d3c5`).

Two parts of your report are addressed:

- The per-Agent state no longer lives in a module-level `WeakMap`. The fence record is now a `WeakSet<Agent>` held by the `BashTerminalBackend` instance that registered it, so the state has the same owner as the backend that created it.
- The fence no longer calls captured service instances. It resolves `sandboxPolicy` and `terminals` through the owner's scope when the `sandbox/mode` event is dispatched, so a disposed or replaced service is never invoked, and the generation that is live at that moment decides the comparison.

The second point also fixes a defect your report did not have to reach: because the old fence compared a mode change against the *withdrawn* generation's default, replacing the sandbox-policy service made it refuse a change that the live default already matched, and let a genuine narrowing through while the open PTYs stayed confined under the previous mode. Reading the policy live removes both outcomes. When no policy service is present there is no effective mode to compare against, and when no terminal registry is present there is no activity to protect; in both cases the fence stays inert instead of raising an unrelated error.

One part of your expected behavior we did not take, on purpose. The fence listener still lives on the owner's scope, so it is not removed when terminal-bash unloads. The package README states that the fence is attached to the exact owner and outlives a provider reload that retains existing sessions, and the open PTY sessions are owned by the terminal registry rather than by terminal-bash — dropping the fence on unload would let a downgrade pass while those PTYs are still confined under the mode they started with. We therefore treat "remove the fence when the plugin unloads" as a semantics decision that needs maintainer agreement rather than something to change inside a bug fix; we would like to discuss it.

One smaller consequence of moving the record onto the backend instance: after a provider reload, the replacement backend registers one additional equivalent fence listener for the same owner, where the module-level map used to dedupe across instances. Both listeners resolve the services live and reach the same verdict, and both are removed with the owner.

Evidence: the terminal-bash package suite passes (118 passed, 3 skipped) and `packages/terminal/terminal-bash/src/index.ts` keeps 100% statement, branch, function, and line coverage. Negative control: with `src/index.ts` reverted to `origin/master`, the new test fails because the fence still compares against `read-only` and refuses a change the live default already matches.

## 中文

感谢报告——我们已经接手（见上方声明），并在分支 `fix/terminal-bash-sandbox-fence-live-policy`（基于 upstream `master` `841f76d3c5`）上落地了一个窄修复。

报告中的两部分已经处理：

- 每个 Agent 的状态不再放在模块级 `WeakMap` 里。fence 记录改为由注册它的 `BashTerminalBackend` 实例持有的 `WeakSet<Agent>`，状态与创建它的 backend 拥有同一个所有者。
- fence 不再调用捕获的服务实例。它在 `sandbox/mode` 事件派发时通过 owner 的作用域读取 `sandboxPolicy` 与 `terminals`，因此不会调用已释放或被替换的服务，并且由当时生效的那一代决定比较结果。

第二点还修掉了报告未必覆盖到的缺陷：旧 fence 用*已撤销*一代的默认值比较模式变更，所以替换沙箱策略服务后，它会拒绝一个与当前默认值本就相同的变更，同时放行真正的收窄变更——而此时打开的 PTY 仍受旧模式约束。改为实时读取策略后，这两种结果都消失了。没有策略服务时不存在可比对的有效模式，没有终端注册表时没有需要保护的活动；这两种情况下 fence 保持不作为，而不是抛出无关错误。

我们有意没有采纳预期行为中的「fence 随插件卸载而移除」。fence 监听器仍挂在 owner 的作用域上，因此不会随 terminal-bash 卸载而移除。包 README 明确写明该限制绑定到确切所有者，并在保留现有会话的提供方重新加载后依然有效；而打开的 PTY 会话由终端注册表拥有，而不是由 terminal-bash 拥有——在卸载时移除 fence，会让降级在那些 PTY 仍受启动时模式约束期间通过。因此我们把「插件卸载时移除 fence」视为需要维护者认同的语义决定，而不是可以在缺陷修复里顺手改掉的东西；我们希望就此讨论。

记录移到 backend 实例还有一个较小的后果：提供方重载后，替换的 backend 会为同一 owner 再注册一个等效的 fence 监听器，而模块级 map 过去会跨实例去重。两个监听器都实时读取服务、得出相同结论，并且都随 owner 一起移除。

证据：terminal-bash 包测试通过（118 通过、3 跳过），`packages/terminal/terminal-bash/src/index.ts` 保持语句、分支、函数、行覆盖率 100%。负对照：把 `src/index.ts` 还原为 `origin/master` 后新用例会失败，因为 fence 仍以 `read-only` 比较，拒绝了一个与生效默认值本就相同的变更。
