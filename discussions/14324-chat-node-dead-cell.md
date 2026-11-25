<!--
状态：草稿，未发布。
用途：Discussion #14324 的回复正文，供作者过目后决定是否发布。
说明：线程已由其他贡献者完成机制定位（dsh-web-preview-panel replaceChild 假设 + DOM 探针）；本稿只补充未被覆盖的一点：死 cell 的不可见 crash face 本身是一个 UX 缺口。
注意：初稿的「官方渲染器二次崩溃」推断错误——keyed cell 每个键只有一名占用者，"WC" 即官方 chat 插件本身，一次崩溃后该 kind 全部行变为 data-slot-error 裸锚点，已按此修正。
-->

# English reply (for posting to Discussion #14324)

The follow-up analysis in this thread already answers both questions thoroughly, so only two additions from the source side:

- **`plugin: "WC"` is the shipped chat plugin itself**, not a third-party registrant — your slot inspection is consistent: each key of `conversation.chat.node` has exactly one occupant, the shipped renderer. So a single crash retires the only entry in that cell, and every row of that `ChatNodeKind` then renders the dead-cell crash face. There is no "survivor entry" to fall back to — keyed cells only have survivors when a plugin *shadows* a shipped renderer. And `abdicated` is a `WeakSet` nothing ever clears, so the dead cell is permanent until the renderer reloads; the slot API, plugin API and shell options expose no retry, remount or fallback path.
- **The dead-cell face is deliberately-but-invisibly blank.** `scoped-slots.tsx` renders a bare `<div data-slot-error="conversation.chat.node">` for a cell whose every registration abdicated; the owner's `opts.fallback` (`JsonBlock` in `ChatNodeSeat`) covers only the never-occupied case, not a dead cell. The design intent is that a dead cell is a failure state rather than "natural empty" — but rendering an invisible element means the failure reads as "an empty assistant reply" instead of "rendering failed." Making that face a small visible notice (localized, e.g. "content failed to render") is a product/design call the maintainers may want to take; from the report it is clear the current shape hides the failure from users who don't open devtools.

On the culprit hypothesis: the `dsh-web-preview-panel` `replaceChild`-under-React-tree mechanism matches the signature exactly, including why it fires at stream-settle (the shipped markdown renderer turns relative links from text into `<button>`s at that moment, which is when React removes the text nodes a body-watching replacer may already have moved). Your third crash — a short reply whose only notable element was a relative markdown link — sits exactly on that predicted trigger. The `[data-slot-error]` + `[data-chat-flow-kind]` probes and the DOM tracer in the earlier comment are the right next step; a trace naming the preview panel would be a useful lead, but needs to be correlated with the particular node and operation; disabling the plugin and reproducing under comparable conditions would provide stronger evidence.

# 中文对照（仅供作者阅读，不发布）

线程里后续分析已经把两个问题都答得很完整，源码侧只补两点：

- **`plugin: "WC"` 就是官方 chat 插件本身**，不是第三方占位者——与你的 slot 检查一致：`conversation.chat.node` 的每个键只有一名占用者，即官方渲染器。所以一次崩溃就让该 cell 唯一条目退役，该 `ChatNodeKind` 的所有行随后都渲染死 cell 的 crash face。keyed cell 只有在插件*遮蔽*官方渲染器时才有「幸存条目」可回落。而 `abdicated` 是一个从不清理的 `WeakSet`——死 cell 持续到 renderer reload 为止；slot API、插件 API 与 shell 选项都没有重试、重挂或回落通道。
- **死 cell 的面是有意但不可见的空白。** `scoped-slots.tsx` 对全部条目 abdicated 的 cell 渲染裸 `<div data-slot-error="conversation.chat.node">`；owner 的 `opts.fallback`（`ChatNodeSeat` 的 `JsonBlock`）只覆盖「从未有条目」，不覆盖死 cell。设计意图是死 cell 属于失败态而非「天然为空」——但渲染不可见元素意味着失败在用户眼里读作「一条空的助手回复」而不是「渲染失败」。把这个面换成可见的小型提示（本地化，如「内容渲染失败」）是维护者可以拍板的产品/设计点；从报告看，当前形态对不开 devtools 的用户隐藏了失败。

关于嫌疑假设：`dsh-web-preview-panel` 在 React 树下 `replaceChild` 的机制与特征完全吻合，包括为什么在流式结算时触发（官方 markdown 渲染器在那一刻把相对链接从文本变成 `<button>`，正是 React 删除那些可能已被 body 监听器挪走的文本节点的时刻）。你第三次崩溃的短回复——唯一显著元素就是一个相对链接——正落在该预测触发点上。上一条评论里的 `[data-slot-error]` + `[data-chat-flow-kind]` 探针和 DOM tracer 是正确的下一步；若追踪指向 preview panel，这是有价值的线索，但还需关联具体节点和操作；在可比条件下禁用插件并复现，能提供更强证据。
