<!--
状态：草稿，未发布。
用途：Discussion #14311 的回复正文，供作者过目后决定是否发布。
说明：核对本地 b01aa6d52d；区分已有机制与真实缺口；未验证 Desktop 0.2.2 运行时。
-->

# English reply (for posting to Discussion #14311)

Both asks land closer to existing seams than they appear — one needs a UI cut-point, the other a wire format decision:

**1. Edit a sent message → the backend half exists already.** `session/fork` is a remote API on `ApiSessionList` (`session-controller`): it accepts an explicit `atSeq` (inclusive cut — open turns get synthetic fork closers) and creates a new Session from that event prefix while the original log stays intact — this is exactly your "Branch" semantics, and the session-list UI already exposes Fork (latest completed turn) via context menu. The gap is narrower than the request: the UI's `forkSession` never passes `atSeq`, so today you can only branch at the latest completed boundary, not at an arbitrary message. "Edit message → fork at it → resend" is therefore a client-side feature over an existing API, not a store redesign: the append-only log is already designed for this — forks never rewrite history, `updatedAt`/stats stay honest, and the original is untouched, which also gives you the "undo" property for free. A destructive "truncate & rerun" mode would be the genuinely new and riskier surface.

**2. Quote/annotate → a selection-quote flow exists, minus the structured reference.** The shipped `dsh-message-quotes` plugin already does most of the interaction you describe: selecting text in a message surfaces a quote action through `ctx.uiConversation.interactions`, and the composer inserts it as an atomic QuoteNode. What it does *not* carry is your structured part — it serializes as ordinary Markdown blockquotes (`> ` per line), so the model sees the quoted text verbatim but not *which message* it came from or *which range*. A `<quote message=… range=…>` wire form is a new model-visible contract: it needs its own serialized representation, and the `mNNNNN` refs you mention are internal to `session-reference` context tooling rather than a transcript-addressable identity — a structured quote would first need a stable per-message id surfaced for this purpose. Worth splitting the ask: the annotation chip/UX is a client feature; the message+range reference is a wire-format decision maintainers would want to weigh against the existing plain-blockquote form.

The narrowest concrete asks for maintainers, then: (a) expose `atSeq` through `forkSession` plus an "edit/fork at this message" entry on sent messages — UI work over an existing RPC; (b) decide whether quoting should carry structured message+range provenance — a wire decision, with the plain-blockquote form as the status quo.

# 中文对照（仅供作者阅读，不发布）

两项诉求都比表面上更接近现有接缝——一个缺 UI 切点，另一个缺 wire 格式决定：

**1. 编辑已发消息 → 后端那一半已经存在。** `session/fork` 是 `ApiSessionList` 上的远程 API（session-controller）：接受显式 `atSeq`（含端点切分——未完成的轮次会补合成 fork 闭合事件），从该事件前缀创建新 Session 且原日志完整保留——这正是你要的「Branch」语义，会话列表 UI 也已通过右键菜单暴露 Fork（切到最新完成轮）。缺口比诉求窄得多：UI 的 `forkSession` 从不传 `atSeq`，所以今天只能在最新完成边界分叉，不能在任意消息处分叉。「编辑消息→在该消息处分叉→重发」因此是既有 API 上的客户端功能，而非存储层改造：append-only 日志本就为此设计——fork 不改写历史，`updatedAt`/统计保持诚实，原会话不动，「撤销」性质免费获得。破坏性的「截断重跑」模式才是真正新增且风险更高的面。

**2. 引用/批注 → 选中引用流程已存在，缺的是结构化引用。** 出厂的 `dsh-message-quotes` 插件已经实现了你描述的大部分交互：在消息中选中文本会经 `ctx.uiConversation.interactions` 浮出引用动作，composer 以原子 QuoteNode 插入。它**不**携带的是你的结构化部分——序列化为普通 Markdown 引用块（每行 `> `），模型能看到引用文本本身，但不知道*来自哪条消息*或*哪个区间*。`<quote message=… range=…>` 形式是新的模型可见契约：需要自己的序列化表示，而你提到的 `mNNNNN` 引用是 `session-reference` 上下文工具的内部形态，不是可直接寻址转录消息的标识——结构化引用需要先为此暴露稳定的 per-message id。建议拆分诉求：批注 chip/交互是客户端功能；消息+区间引用是 wire 格式决定，维护者需要与现有纯引用块形式权衡。

给维护者最窄的两个具体诉求：(a) 让 `forkSession` 透出 `atSeq` 并在已发消息上加「在此编辑/分叉」入口——既有 RPC 上的 UI 工作；(b) 决定引用是否应携带结构化消息+区间来源——wire 决定，纯引用块为现状基线。
