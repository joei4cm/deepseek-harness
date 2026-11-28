<!--
Status: draft, not published.
Target: Discussion #14422.
Do not publish without explicit user authorization and a fresh check for new comments.
-->

# English reply (draft)

Thanks for the report — the error-ledger breakdown across four sessions, and the fact that the main-agent request on the same route with the same effort succeeds while only the review request fails, pin the defect to the reviewer's request construction rather than to the provider or the account.

We took this on against current `master` (`4b399c39a6`). Our reading matches yours: `snapshotAutoReview` copies `header.config.provider` and `header.config.model` and drops `header.config.reasoningEffort`, and the LLM runtime resolves an omitted effort to the route's `reasoning.defaultEffort`, which on a thinking-only route is thinking-disabled — so the provider rejects the request and the fail-closed reviewer blocks the tool body.

Our branch is `fix/auto-review-reasoning-effort` (`e741a07aed875a7392c723e6233fa985f902ae6d`), written from your report. We also saw the parallel implementation you prepared on your own fork (`Ruiyi-Zhang-BUPT` branch `fix/auto-review-reasoning-effort`, commit `4442edfdcc`, linked in #14059 and here): this branch is an independent implementation, and no code from it was imported. The behavior it reaches is the same one you describe — inherit the header's effort, keep the field absent when the header records none, no clamp or alias, fail-closed unchanged.

The implementation:

- The review snapshot carries the reviewed Session's recorded `reasoningEffort` next to its provider and model. A header that recorded one contributes it to the reviewer's `GenerateOptions`; a header that recorded none leaves the field absent, so the shipped adapter default still applies exactly as before.
- Nothing else moves. The reviewed Session's own request, the tool schema, the risk policy, the allow/deny decision, and the failure behavior are unchanged — a reviewer failure still blocks the tool body and never opens it.
- The package README pair and the implemented Auto review Agent Note now state the same fact in both languages, with their bilingual records re-recorded.

On your three questions:

1. Reusing the Session's effort, as you propose in the branch. Clamping to the lowest supported thinking level would silently change the reasoning level the user chose, and the LLM runtime deliberately does neither clamping nor aliasing. A `reviewerReasoningEffort` setting would add a knob to a reviewer policy that is deliberately fixed and not configurable, and it would need its own precedence rule against the Session effort. Propagating the header value is also the cheapest of the three: the value in the header is one this exact provider/model route already accepted, and the reviewer uses the same route, so it cannot send a field the model rejects. If the route changes after the header and the value stops being supported, the runtime rejects with `UNSUPPORTED_REASONING_EFFORT` and the reviewer still fails closed rather than silently switching levels.
2. If a clamp is ever wanted, it belongs in the LLM service layer, not in `auto-review`. Reading `prepareCall`'s model-info `configure` callback to pick a level inside this package would put a generic effort-selection rule into one consumer of the LLM service. A shared helper there is the shape we would use; we did not add one, because no current consumer asks for it.
3. No snapshot is needed, and we agree with your reasoning. The review request does not enter the Session log and changes no model-visible text or tool schema; the recorded auto-review scenarios script the reviewer and assert no request control field. We added package-level unit coverage instead.

Validation: the auto-review package suite passes (41 tests), with 100% statement, branch, function, and line coverage for `packages/experimental/auto-review/src`. The new case fails against `master`'s source and passes with the change. Typecheck, lint, and the documentation gates pass.

One limit on the evidence: this checkout has no `zai-coding-cn / glm-5.3-flash` route or credentials, so we could not reproduce the real 400. The new case reproduces the structure instead — a controlled route whose advertised efforts differ from its default effort — so it fails for the same reason a thinking-only route fails.

Upstream does not accept external pull requests, so the branch sits on the fork.

# 中文对照（仅供阅读，不发布）

感谢这份报告——错误账本在四个会话上的分布，以及「同一 route、同一 effort 下主 agent 请求正常、只有 reviewer 请求失败」这个对照，都把缺陷定位到 reviewer 请求的构造，而不是 provider 或账号。

我们对照当前 `master`（`4b399c39a6`）接手了这个问题。结论与报告一致：`snapshotAutoReview` 复制了 `header.config.provider` 与 `header.config.model`，丢掉了 `header.config.reasoningEffort`；LLM runtime 对省略的 effort 回落到路由的 `reasoning.defaultEffort`，在 thinking-only 路由上就是 thinking-disabled，于是 provider 拒绝请求，fail-closed 的 reviewer 随即阻断工具体。

我们的分支是 `fix/auto-review-reasoning-effort`（`e741a07aed875a7392c723e6233fa985f902ae6d`），依据你的报告写成。我们也看到了你在自己 fork 上准备的并行实现（`Ruiyi-Zhang-BUPT` 分支 `fix/auto-review-reasoning-effort`，提交 `4442edfdcc`，在 #14059 与本讨论中给出链接）：本分支是独立实现，未导入其任何代码；两者达到的行为相同——沿用 header 的 effort、header 未记录时保持省略、不 clamp、不 alias、失败策略不变。

实现如下：

- 评审快照在被评审 Session 的 provider 与 model 之外，携带该 Session 记录过的 `reasoningEffort`。header 记录过就把该值写入 reviewer 的 `GenerateOptions`；header 没记录就仍然省略该字段，shipped adapter 的默认 reasoning 依旧生效。
- 其他都不变：被评审 Session 自身的请求、工具 schema、风险策略、allow/deny 判定与失败行为都保持原样——reviewer 失败仍然阻断工具体，从不放开。
- 包 README 中英双语与 implemented 的 Auto review 决策记录现在都写明同一事实，两侧的 i18n 记录已重新记录。

关于你的三个问题：

1. 沿用被评审 Session 的 effort，也就是你分支里的做法。clamp 到最低支持的 thinking 级别会静默改变用户选择的推理档位，而 LLM runtime 明确既不 clamp 也不 alias。`reviewerReasoningEffort` 配置会给刻意固定、不可配置的 reviewer 策略再加一个旋钮，还需要额外决定它与 Session effort 的优先关系。传播 header 的值也是三者中最省事的一种：header 里的值正是这条 provider/model route 已经接受过的，reviewer 走同一条 route，因此不会向模型发送被拒绝的字段。若 route 在 header 之后变化导致该值不再受支持，runtime 会以 `UNSUPPORTED_REASONING_EFFORT` 拒绝，reviewer 依旧 fail-closed，不会悄悄换档。
2. 如果将来真要 clamp，它应放在 LLM service 层，而不是 `auto-review` 里。在本包内读 `prepareCall` 的 model-info `configure` 回调来挑档位，等于把一个通用的 effort 选择规则塞进 LLM service 的某一个消费方里。我们会采用那里的共享 helper；这次没有加，因为目前没有消费方提出这个需求。
3. 不需要 snapshot，我们的判断与报告一致：reviewer 请求不进入 Session 日志，也不改变模型可见文本或工具 schema；已有的 auto-review 录制场景由 fixture 脚本化 reviewer，并不断言请求控制字段。我们改用包内单元测试覆盖。

验证：auto-review 包测试全绿（41 个测试），`packages/experimental/auto-review/src` 达到语句、分支、函数、行 100% 覆盖；新增用例在 `master` 源码下失败、在改动后通过。typecheck、lint 与文档门禁通过。

一点证据局限：本检出没有 `zai-coding-cn / glm-5.3-flash` 路由与凭据，无法复现真实的 400。新用例改为复现同一结构——一条声明的 efforts 与默认 effort 不同的受控路由——因此它与 thinking-only 路由以同样的理由失败。

上游不接受外部 PR，因此该分支暂存在 fork 上。
