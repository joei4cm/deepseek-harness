<!--
状态：草稿，未发布。
用途：Discussion #14324 的回复正文，供作者过目后决定是否发布。
说明：源码分析（packages/client/ui-renderer、ui-slots、ui-chat），无代码改动分支。
-->

# English reply (for posting to Discussion #14324)

`abdicated: true` is a known, intentional failure mode — it is the slot system's containment for a crashing renderer. What is happening in your log:

1. `conversation.chat.node` is a *keyed, shadowing* slot: each `ChatNodeKind` is a cell whose entries shadow each other in priority order. A `SlotErrorBoundary` wraps every entry element.
2. When an entry crashes, the boundary reports it and — for shadowing kinds — `abdicate`s it: the entry is permanently retired from its cell and the outlet re-renders onto the cell's **next survivor**. So one plugin renderer crashing should, by design, hand the row back to the official renderer rather than blank it.
3. A cell whose *every* registration has abdicated renders the crash face: a bare `<div data-slot-error="conversation.chat.node">` — which is exactly the empty block you see. The `opts.fallback` your slot owner passes (`JsonBlock` in `ChatNodeSeat`) is only for the never-occupied case, not for a dead cell.

So the persistent blank means every entry in that cell crashed — the plugin entry (logged as `slot.crashed` because the host log only tracks dynamic/plugin entries) *and* the official renderer, whose crash only goes to `console.error('slot entry crashed in ...')` in the devtools console, not to the host log. Worth checking your console for that line to confirm the second crash.

`NotFoundError: removeChild` is the classic signature of code outside React's tree mutating DOM that React owns — React's commit goes to remove a node and the node is already gone, so the commit throws inside whichever component was unmounting/updating at that moment (which is why it lands right when a long streamed message finishes and nodes re-mount). Since nothing inside React's own renderers mutates foreign DOM, that points to a plugin doing direct `remove()`/`replaceWith()`/innerHTML on elements inside the chat flow — `dsh-context` and `dsh-better-sidebar` are the right first suspects given they are both listed as DOM-mutating there.

Answers to your two questions:

1. Yes, `abdicated` is the known containment mode, and the way to keep one crashed node from blanking is already the survivor re-render — it only fails once every occupant of the cell has crashed, which in this case almost certainly means the DOM corruption killed the survivor's re-render too. (Rendering a visible "content failed to render" notice instead of the bare anchor for a dead cell is a product/design call worth making to the maintainers, not something a plugin can control.)
2. There is no declared incompatibility — but the crash signature is DOM interference, so bisecting by disabling the DOM-mutating plugins is the right move. Useful probes: `document.querySelectorAll('[data-slot-error]')` shows exactly which cells are dead, and the dynamic-plugin run surface (`renderFailures`) already displays the last crash per plugin.

# 中文对照（仅供作者阅读，不发布）

`abdicated: true` 是已知的、有意设计的失败模式——它是 slot 系统对崩溃渲染器的收容。日志里发生的序列：

1. `conversation.chat.node` 是 keyed/shadowing 槽位：每个 `ChatNodeKind` 是一个 cell，cell 内条目按优先级遮蔽。每个条目都有 `SlotErrorBoundary` 包裹。
2. 条目崩溃时边界上报并 abdicate 该条目：它从 cell 中永久退役，outlet 重新渲染到 cell 的**下一个幸存条目**。按设计，一个插件渲染器崩溃应把该行交还官方渲染器，而不是置空。
3. 当 cell 内**全部**条目都已 abdicate，cell 渲染 crash face：一个裸的 `<div data-slot-error="conversation.chat.node">`——正是你看到的空块。owner 传的 `opts.fallback`（`ChatNodeSeat` 里的 `JsonBlock`）只覆盖「从未有条目」的情形，不覆盖死 cell。

所以持续空块意味着该 cell 的每个条目都崩溃了——插件条目（`slot.crashed` 记进 host log，因为该日志只追踪动态插件条目）**以及**官方渲染器，其崩溃只进 devtools console 的 `slot entry crashed in ...`，不进 host log。建议查 console 里这一行确认第二次崩溃。

`NotFoundError: removeChild` 是 React 树外代码改动 React 托管 DOM 的典型特征——React commit 阶段要删除的节点已经不在，于是在当时正在卸载/更新的组件内部抛出（所以它恰好落在长流式消息完成、节点重挂载的时刻）。React 自己的渲染器不改动外部 DOM，因此指向在 chat flow 内直接 `remove()`/`replaceWith()`/innerHTML 的插件——`dsh-context` 与 `dsh-better-sidebar` 都自称改 chat DOM，是正确的一号嫌疑。

对你两个问题的回答：

1. `abdicated` 是已知的收容模式；让一个崩溃节点不空白的机制就是幸存条目重渲——它只在 cell 内全部条目崩溃后才失效，而本例几乎可以确定是 DOM 破坏把幸存者的重渲也打死了。（把死 cell 从裸锚点改成可见的「内容渲染失败」提示是产品/设计层面的取舍，值得向维护者提出，插件侧无法控制。）
2. 没有声明过的不兼容——但崩溃特征就是 DOM 干扰，所以按「禁用改 DOM 的插件」做二分是正确动作。可用的探针：`document.querySelectorAll('[data-slot-error]')` 直接显示哪些 cell 已死，动态插件运行面（`renderFailures`）已经显示每个插件的最近一次崩溃。
