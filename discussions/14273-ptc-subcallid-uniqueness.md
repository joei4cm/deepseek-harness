<!--
状态：草稿，未发布。
用途：Discussion #14273 的回复正文，供作者过目后决定是否发布。
目标渠道：上游仓库的 Discussions（上游 CONTRIBUTING 声明不接受外部 PR、Issues 已关闭，Discussions 是唯一被认可的反馈渠道）。
说明：本仓库是 fork；本回复为分析，未附代码改动——修复方向依赖维护者对「调用 id 跨轮复用是否实际发生」与「唯一性归属」的决策。
-->

# English reply (for posting to Discussion #14273)

I traced this on `master` and the report's core tension is real: the format requires a session-unique `subCallId`, the producer derives it from a call id the format explicitly allows to repeat across turns, and the failure lands on restore — the worst possible place.

**The two contract halves**

1. `tool/ptc-dispatch-start` requires a session-unique `subCallId`: the V4 relationships validator refuses "PTC dispatch repeats subCallId" for the whole session lifetime (`packages/session/session-format-v3-to-v4/src/relationships.ts`, `dispatch()`), and this is not a migration-only rule — JSONL restore runs `assertReleasedV4Relationships` over the full artifact when the log is scanned (`packages/session/session-persistence-jsonl/src/format.ts`, `finish()`). A session that contains a duplicate fails to restore, which turns a producer assumption into an unrecoverable session.
2. The PTC producer mints `subCallId = <callId>:ptc:<n>` (`packages/core/tool-executor-ptc/src/ptc.ts`), where `n` counts dispatch attempts within one `run_code` execution only. Session-wide uniqueness therefore rests entirely on `exec.callId` — the model-content-derived `run_code` call id — being session-unique.

**Why the reuse window is format-legal**

The same validator frees a tool-call id at `tool/result` (`tools.delete(id)`) and accepts re-advertising the same id in a later turn's `assistant/message`; only a duplicate inside one message is refused. Providers that derive call ids from request content make cross-turn reuse realistic — two `run_code` calls in different turns can both be `call_X`, and both then emit `call_X:ptc:1`. Within one PTC run the counter is monotonic, so cross-turn reuse is the only collision window, but it is the window the format itself blesses.

Downstream, the client's tool-call tree folds dispatch nodes by `subCallId` into the call tree (`packages/client/ui-chat/src/client/model/tool-call-tree.ts`), so a duplicate would attach the second run's dispatches under the first run's subtree even before any persistence check.

**Why I did not just patch it**

Every uniquifier I sketched needs a decision above the PTC package:

- **Add turn/step to the derivation**: `ToolExecution` carries no turn/step fields, and widening the shared executor contract for one producer is a cross-package design change.
- **Session-scoped counter**: the PTC executor's lifetime is one `run_code` call; there is no session-lifetime owner to hold the counter, and a module-level counter is exactly the shared state without an owner the conventions forbid.
- **Session-offset suffix**: needs either an O(n) scan or a monotonic service — again an owner question.
- **Format-side hardening instead**: make V4 admission refuse cross-turn tool-call id reuse, closing the window at the contract level. That changes a released-format relationship rule; same-version changes require safe reader behavior, so it is a format governance decision, not a patch.

One reassurance for whichever direction wins: no production code parses the `:ptc:` suffix — consumers key on the whole `subCallId`; only test fixtures construct such ids literally. Changing the derivation shape does not break a parser.

The questions that decide the direction, for whoever picks this up: is cross-turn call-id reuse actually observed with any shipped provider (content-derived ids)? Should the uniqueness owner be the session log (mint subCallIds at admission) or the producer? And is format-side hardening (refuse reuse at admission) preferable to producer-side uniquification? I am glad to prepare a concrete branch for the chosen direction.

# 中文对照（仅供作者阅读，不发布）

我在 `master` 上完整追了一遍，报告的核心张力属实：格式要求 `subCallId` 会话内唯一，而生产者从「格式明确允许跨轮复用的调用 id」推导它，失败落在 restore——最糟的位置。

**契约的两半**

1. `tool/ptc-dispatch-start` 要求 `subCallId` 会话内唯一：V4 relationships 校验器在整个会话生命周期内拒绝 "PTC dispatch repeats subCallId"（`packages/session/session-format-v3-to-v4/src/relationships.ts` 的 `dispatch()`），而且这不是仅迁移期的规则——JSONL restore 在扫描日志时对完整 artifact 跑 `assertReleasedV4Relationships`（`packages/session/session-persistence-jsonl/src/format.ts` 的 `finish()`）。含有重复的会话无法 restore，生产者的假设由此变成不可恢复的会话。
2. PTC 生产者生成 `subCallId = <callId>:ptc:<n>`（`packages/core/tool-executor-ptc/src/ptc.ts`），其中 `n` 只在一次 `run_code` 执行内计数派发尝试。于是会话级唯一性完全压在 `exec.callId`——模型内容衍生的 `run_code` 调用 id——是否会话内唯一上。

**复用窗口为何是格式合法的**

同一个校验器在 `tool/result` 释放调用 id（`tools.delete(id)`），并接受后续轮次的 `assistant/message` 重新通告同一 id；只有同一条消息内的重复被拒绝。从请求内容衍生调用 id 的 provider 使跨轮复用现实存在——不同轮的两个 `run_code` 调用可以都是 `call_X`，然后都发出 `call_X:ptc:1`。单次 PTC 运行内计数器单调，所以跨轮复用是唯一碰撞窗口，但它恰恰是格式自己祝福的窗口。

下游方面，客户端的工具调用树把派发节点按 `subCallId` 折叠进调用树（`packages/client/ui-chat/src/client/model/tool-call-tree.ts`），所以重复会在任何持久化检查之前就把第二次运行的派发挂到第一次运行的子树下。

**为什么我没有直接补**

我试过的每个唯一化方案都需要 PTC 包之上的决策：

- **在推导里加 turn/step**：`ToolExecution` 没有 turn/step 字段，为一个生产者拓宽共享执行器契约是跨包设计变更。
- **会话级计数器**：PTC 执行器的生命周期是一次 `run_code` 调用；没有会话级所有者来持有计数器，模块级计数器正是约定所禁止的「无主共享状态」。
- **会话偏移后缀**：需要 O(n) 扫描或单调服务——同样是所有者问题。
- **改为格式侧加固**：让 V4 准入拒绝跨轮的调用 id 复用，在契约层关掉窗口。这改变已发布格式的 relationship 规则；同版本变更要求读取侧行为安全，所以是格式治理决策，不是补丁。

对无论哪个方向的一个安心点：没有生产代码解析 `:ptc:` 后缀——消费方以整个 `subCallId` 为键；只有测试 fixture 直接构造这类 id。改推导形态不会破坏任何解析器。

决定方向的问题，留给接手的人：任何已上架 provider 是否实际观测到跨轮调用 id 复用（内容衍生 id）？唯一性的所有者应是会话日志（准入时铸造 subCallId）还是生产者？格式侧加固（准入拒绝复用）是否优于生产者侧唯一化？方向选定后我可以立刻准备具体分支。
