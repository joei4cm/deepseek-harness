<!--
状态：草稿，未发布。
用途：Discussion #14351 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/session-follow-passive-open` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6，dsh-v0.2.3-alpha.2）；两条路径在当前代码树逐条核对过。
-->

# English reply (for posting to Discussion #14351)

Both paths check out against the current tree, and your reading of the wire contract is exactly right:

1. `packages/api/session-controller/src/client/transport.ts` hardcoded `activate: true` on every `session/follow`, although `SessionFollowRequest` documents omission as the passive read and the controller README's endpoint-activation policy already states that log following can inspect persistence without activating an Agent. The Host side is fine: `WebController.follow` only promotes a prepared session when `activate === true`, and `transport.host.spec.ts` already pins "does not activate a prepared Session when the request omits activate".
2. The slash-command warm hook fires at composer-input mount (the trigger controller's scope-birth prewarm) and pulls the catalog through `commands.list`, whose Typert Agent lookup resumes a prepared session — so even with a passive follow, mounting the composer woke the agent.

The activation side is safe to change because engagement RPCs resolve the Agent independently: `prompt` → `resolveAgent`, and queue/model/rename/commands each resolve or resume on their own. So I made the client conform to the documented policy on a fork branch (`fix/session-follow-passive-open`, based on upstream `master`):

1. **The client follow omits `activate`** — opening or browsing a session activates nothing; live events, Assistant streams, and reconnect repair are unchanged, and subagent follows were never promoted anyway.
2. **The command warm hook prewarms only while the session's agent is already running** (`binding.session.getSnapshot().running`); a cold session's catalog pulls on first use through the existing `candidates()` → `ensureReady` path. The trade-off is one extra `commands.list` round trip the first time you type `/` in a cold session, and typing `/` itself still resumes the agent when you engage — read-only *browsing* no longer does.

Two residual wake paths stay as-is on purpose: reconnect's `resetConnected()` and `commands/change`'s `invalidateAll()` re-pull only keys already in the directory, which after this change only holds sessions you engaged with or that were running; and preset-switch refresh is an engagement action. The outgoing-request shape is pinned by the updated client specs (5 transport expectations + the warm-gate case, 6 of which fail against pre-fix sources), the passive Host contract keeps its existing host spec, and the full GUI suite passes. This machine is Linux, so I could not demo the Desktop agent-list difference live; the behavior is covered by the transport-level tests and the existing Host promotion spec.

The branch and a full pull-request description are ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

# 中文对照（仅供作者阅读，不发布）

两条路径在当前代码树都核实成立，你对 wire 契约的解读完全正确：

1. `packages/api/session-controller/src/client/transport.ts` 在每次 `session/follow` 里写死 `activate: true`，而 `SessionFollowRequest` 的注释明确「省略即被动读取」，控制器 README 的端点激活策略也已声明「日志跟随可以在不激活 Agent 的情况下检查 persistence」。Host 侧本身没问题：`WebController.follow` 只在 `activate === true` 时提升 prepared 会话，且 `transport.host.spec.ts` 已固定「请求省略 activate 时不激活 prepared 会话」。
2. slash 命令的 warm hook 在输入框挂载时触发（trigger 控制器的 scope-birth 预热），经 `commands.list` 拉取目录，而它的 Typert Agent lookup 会恢复 prepared 会话——所以即使 follow 改被动，挂载输入框也会唤醒 Agent。

激活侧可以安全修改，因为参与类 RPC 各自独立解析 Agent：`prompt` → `resolveAgent`，queue、模型、重命名、commands 也都自行解析或恢复。因此我在 fork 分支（`fix/session-follow-passive-open`，基于上游 `master`）上让客户端遵循已声明的策略：

1. **客户端 follow 省略 `activate`**——打开或浏览会话不再激活任何东西；实时事件、Assistant 流、重连修复都不受影响，subagent follow 本来就不会被提升。
2. **命令目录 warm hook 只在会话 Agent 已经 running 时预热**（`binding.session.getSnapshot().running`）；冷会话的目录经既有的 `candidates()` → `ensureReady` 路径在首次使用时拉取。代价是冷会话第一次输入 `/` 时多一次 `commands.list` 往返；而真实输入 `/` 本身仍会恢复 Agent——那是参与行为，只读*浏览*不再如此。

两条残余唤醒路径是有意保留的：重连的 `resetConnected()` 和 `commands/change` 的 `invalidateAll()` 只重拉目录里已有的 key，而改动后目录 key 只存在于你参与过或正在运行的会话；preset 切换刷新属于参与动作。出站请求形状由更新后的客户端规格固定（5 处 transport 期望 + warm 门用例，对 pre-fix 源码 6 个失败），被动 Host 契约继续由既有 host 规格固定，GUI 全套通过。本机是 Linux，无法现场演示 Desktop 的 Agent 列表差异；该行为由传输层测试与既有 Host 提升规格覆盖。

分支与完整的 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。
