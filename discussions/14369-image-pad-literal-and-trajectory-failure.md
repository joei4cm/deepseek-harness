<!--
状态：草稿，未发布。
用途：Discussion #14369 的回复正文，供作者过目后决定是否发布。
说明：两个问题的根因都在当前 master 上逐条核实；问题一属协议决策（转义形式与作用范围），问题二属 GUI 呈现（需设计评审与演示 GIF），本机 gh 2.86 < 2.99 无法附 GIF，因此只交付分析，不开分支。
核对基线：上游 master（4b399c39a6），与报告所记版本一致。
-->

# English reply (for posting to Discussion #14369)

I verified both root causes against current `master` (`4b399c39a6`, the same commit your report names), and both hold as written.

**Problem 1.** The wire chain is exactly where you point: the text-only conversion keeps tool-result text blocks verbatim (`textBlocks()` at `context.ts:24`, `userContent()` at `context.ts:76` push `block.text` untouched), and the literal reaches pi-ai as ordinary text. On the failure side, `classifyPiAiError()` (`stream.ts:49`) has no pattern for "Image features and image tokens do not match", so it falls through to `PI_AI_ERROR`, and the only retry in the request path — `dsh-compaction-image-offload` — reacts to `IMAGE_OFFLOAD_REQUIRED` alone (`compaction-image-offload/src/index.ts:28`), which this error is not. So every later turn re-sends the same context and asserts the same way. Confirmed.

One piece of arithmetic that matters for choosing the fix: the server asserts that the number of image-placeholder positions equals the number of visual feature rows. A literal `<|image_pad|>` in text always adds a placeholder position, and no number of *dropped* real images can make the two sides equal again — one literal with zero images still asserts `tokens: 1, features: 0`. That rules out fix 2 (classify as recoverable and offload/retry) as a complete repair: it cannot clear a history that already carries the literal. Escaping at the transport layer (your fix 1) is the only proposal that covers every affected history, including sessions that are bricked today — which is also why I agree the escape belongs at the boundary and not in user guidance.

What the escape still needs is a decision, and I would rather put the options on the table than pick silently:

- **Which strings.** The narrow set is the two tokens `get_placeholder_mask()` counts as placeholders, `<|image_pad|>` and `<|video_pad|>`. `<|vision_start|>`/`<|vision_end|>` in text are plain tokens to the mask and do not assert. A wider set (any `<|…|>` added token) would also protect against template tokens but rewrites far more ordinary content that discusses chat templates.
- **Which form.** This adapter already has a precedent for neutralizing a magic sequence at exactly this boundary: mid-conversation system text escapes `</system-reminder>` as `<\/system-reminder>` (`context.ts:205`). Inserting a backslash after `<` is visible, self-describing, and breaks the exact added-token match. A fullwidth-bar variant is visually nearer the original but silently falsifies echoed file content; a zero-width space is invisible, which is the worst option for anyone auditing the transcript.
- **Which routes.** On a Qwen-family route the literal is dangerous and the escape is a correction; on a route whose tokenizer does not treat it specially (the DeepSeek Messages route, for one) the literal is plain text and escaping it would falsify what the model reads. Scoping the escape to Qwen-family routes puts provider knowledge in a multi-provider adapter; applying it everywhere is simpler but costs fidelity on every other route.

Whichever shape is chosen, the durable log should keep the literal and the request should carry the escaped form — the same documented-projection shape as the lone-surrogate replacement — so a transcript audit can still see what the tool printed.

One thing in the report I could not reconcile from the outside, and it would sharpen the fix's scope: the three self-infected sessions are described as carrying zero real images while showing `tokens: 766, features 765`. With no image the visual features should be 0 and the assertion message should name `tokens: 1, features: 0`, so either those sessions had the same image attached, or the processor expands a bare literal in a way I have not accounted for. If it is the latter, the escape's trigger condition is broader than "literal plus image", and a preflight guard (your fix 3) becomes more attractive as a companion.

**Problem 2.** Also confirmed, at the lines you cite: `assistant/attempt` settles only timing (`trajectory-assistant-definition.ts` `settleTiming`), a request without an assistant message becomes a `requestOnly` cell, `TrajectoryTable` renders that cell as `null`, and `timeline.ts:89`/`:126` drop `requestOnly` cells outright. The data path is already there — `applyTurnErrors()` attaches the `turn/end` failure to the request and the snapshot-builder test asserts it — so this is purely a presentation gap, and Chat's `turn-error` row shows the same event correctly.

The fix is a new visible row in the Trajectory presentation plus a timeline-filter change, which is a user-perceivable UI change; under the repository's UI rules that needs a designer or product review of the row's presentation, and the demonstration GIF that such a pull request must embed needs `gh --attach` (2.99+), which this machine's 2.86 cannot do. So I have not attached a branch for it; the report's fix sketch is complete as far as I can tell, and with a nod on the row's shape we can take it.

For a user sitting on a bricked session today: a new session is the only clean exit. Forking does not escape the literal — the fork replays the parent's log into its own context — and no in-product edit reaches a persisted tool result.

# 中文对照（仅供作者阅读，不发布）

两个根因我都对照当前 `master`（`4b399c39a6`，与你报告所记同一提交）逐条核实，均成立。

**问题一。** 出站链路就在你指的位置：纯文本转换对工具结果文本块原样放行（`textBlocks()` 在 `context.ts:24`，`userContent()` 在 `context.ts:76` 直接推 `block.text`），字面量作为普通文本进入 pi-ai。失败侧，`classifyPiAiError()`（`stream.ts:49`）没有匹配「Image features and image tokens do not match」的模式，于是落到 `PI_AI_ERROR`；请求路径上唯一的重试——`dsh-compaction-image-offload`——只认 `IMAGE_OFFLOAD_REQUIRED`（`compaction-image-offload/src/index.ts:28`），这个错误不是。于是后续每一轮都重发同一段上下文、以同样方式断言。已确认。

有一个对选型关键的算术：服务端断言「图片占位符位置数 = 视觉特征行数」。文本里的字面 `<|image_pad|>` 永远多出一个占位位置，而丢掉再多真实图片也无法让两边重新相等——只剩一个字面量、零张图片时仍会断言 `tokens: 1, features: 0`。这直接排除你的修复 2（分类为可恢复后卸载图片重试）：它清不掉已经带着字面量的历史。传输层转义（你的修复 1）是唯一覆盖所有受影响历史的方案，包括今天已报废的会话——这也是我同意转义应放在边界而非用户指引里的原因。

转义还差三个决定，我宁愿把选项摆出来而不是默默替维护者选：

- **转义哪些字符串。** 最窄集合是 `get_placeholder_mask()` 计作占位符的两个 token：`<|image_pad|>` 与 `<|video_pad|>`。文本里的 `<|vision_start|>`/`<|vision_end|>` 对 mask 是普通 token，不会断言。更宽的集合（任意 `<|…|>` added token）还能顺带保护模板类 token，但会改写大量讨论 chat 模板的普通内容。
- **用什么形式。** 这个适配器在同一条边界上已有先例：会话中途的系统文本把 `</system-reminder>` 转义为 `<\/system-reminder>`（`context.ts:205`）。在 `<` 后插入反斜杠可见、自描述、能打破 added-token 的精确匹配。全角竖线变体视觉上更接近原文，但会悄悄篡改工具回显的文件内容；零宽空格不可见，对审计转录最不利。
- **作用在哪些路由。** 在 Qwen 系路由上，字面量危险、转义是纠正；在分词器不特殊对待它的路由上（DeepSeek Messages 路由就是一例），字面量是普通文本，转义反而篡改模型读到的东西。把转义限定在 Qwen 系路由，意味着多提供方适配器里要放进提供方知识；全局套用更简单，但让其他路由付出保真度。

无论选哪种形状，持久日志都应保留字面量、请求携带转义后的形式——与孤立代理项替换相同的「有据可查投影」形状，转录审计仍能看到工具打印了什么。

报告里有一处我在外部无法对上，它能帮收窄修复的触发条件：三个自感染会话被描述为不带任何真实图片，却报 `tokens: 766, features 765`。没有图片时视觉特征应为 0，断言消息应写 `tokens: 1, features: 0`；所以要么那些会话其实也挂了同一张图，要么处理器会以我未计入的方式展开裸字面量。若是后者，转义的触发条件就比「字面量 + 图片」更宽，你的修复 3（preflight 守卫）作为配套也更值得做。

**问题二。** 同样确认，就在你引的行上：`assistant/attempt` 只结算耗时（`trajectory-assistant-definition.ts` 的 `settleTiming`），没有助手消息的请求变成 `requestOnly` 单元格，`TrajectoryTable` 把它渲染成 `null`，`timeline.ts:89`/`:126` 干脆丢掉 `requestOnly` 单元格。数据链路本来就在——`applyTurnErrors()` 把 `turn/end` 失败挂到请求上，快照构建器测试也断言了这一点——所以这是纯呈现缺口，Chat 的 `turn-error` 行对同一事件渲染正确。

修复是 Trajectory 呈现里新增一行可见行，外加时间线过滤的调整；按仓库 UI 规则，这是用户可感知的 UI 变更，需要设计或产品评审确认该行的呈现，而这类 PR 必须内嵌的演示 GIF 依赖 `gh --attach`（2.99+），本机 2.86 做不到。所以我暂不开分支；报告里的修复草图就我所见是完整的，只要对行的形状点头，我们可以接手。

对今天手里就有一个报废会话的用户：新会话是唯一干净的出口。fork 并不能转义字面量——fork 会把父日志重放进自己的上下文——产品内也没有能触及已持久化工具结果的编辑入口。
