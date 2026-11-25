<!--
状态：草稿，未发布。
用途：Discussion #14325 的回复正文，供作者过目后决定是否发布。
说明：仅源码分析（ui-chat、session-controller），无代码改动；性能方案属架构决策。
注意：原稿按「切页卡顿」写，讨论更新为「持续卡顿、与切页无关」后已重写。
-->

# English reply (for posting to Discussion #14325)

Thank you for the detailed report — the session-size numbers plus "continuous jank independent of page switching" narrow the search considerably. Checked against the current source:

**What is and isn't virtualized**

- The virtualizer you found (`useVirtualizer` in `TurnNavigator.tsx`) is the **turn rail** — the ~25 turn buttons on the side. The main conversation flow (`ChatFlow` → `ChatNodeSeat`) has **no DOM-level windowing at all**: every node in the *loaded window* mounts a seat, and every step inside every turn mounts too.
- The loaded window is the real bound, not the whole log: the Client's `follow`/`loadOlder` pages request ≥50 user/assistant messages across ≥2 `turn/start`s, up to a 500-message cap. For your session that's likely the 500-message tail — thousands of DOM nodes and hundreds of seats **all permanently mounted**, participating in every style/layout pass.
- `ChatNodeSeat` is already `memo`'d, so settled turns don't *re-render* on unrelated updates — the per-frame cost is not React reconciliation. It's that layout/style work scales with mounted DOM: the scroll machinery (`use-chat-viewport`, `flow-motion`, anchor/paging code) reads `getBoundingClientRect`/`offsetHeight` in several places, and each read forces layout over the entire mounted window. Hundreds of heavy seats (markdown, code blocks, tool output) make each forced layout expensive — sustained jank during scroll/typing without any remount, exactly matching your "not related to page switching" observation. The page switch is just the worst case (fresh mount of the same window).

**On the four suggestions**

1. *Sink virtualization to flow items / window the steps* — the right long-term shape, but nontrivial: the flow's own scroll machinery measures node offsets (`data-chat-paging-anchor`, turn-jump landing, history-prepend anchoring), so unmounted or skipped items must preserve measurement or jumps and anchoring break.
2. *Memo settled turns* — already done (`ChatNodeSeat` is `memo`); the gap is layout cost over mounted DOM and per-frame forced layouts, not reconciliation.
3. *`content-visibility: auto` + `contain-intrinsic-size`* — the strongest cheap candidate, precisely because it removes offscreen subtrees from style/layout (the actual continuous-jank driver), while keeping them findable. One real hazard to test before landing: skipped subtrees report intrinsic sizes to the scroller, and the chat's anchor/jump machinery reads real offsets — a wrongly sized skipped node could desync paging anchors or jump landings. Worth a focused experiment; note `auto` (unlike the `hidden` tried in #12563) keeps text findable.
4. *Avoid rebuilding/re-measuring* — for continuous jank the measurable target is "how many forced layouts per scroll frame over how much DOM"; traces will show whether it's dominated by the viewport machinery's reads or by layout/paint of heavy content.

None of these is a one-line patch — per-item windowing, anchor-preserving `content-visibility`, and cheaper scroll-path measurement are three different architectures for the same problem, and the maintainers should pick the shape. A Performance trace during *scrolling* (not page-switching) showing style/layout vs. paint vs. JS would pick between them; your offered trace plus the session-size data would be genuinely useful.

# 中文对照（仅供作者阅读，不发布）

感谢详细的报告——会话规模数据加「持续卡顿、与切页无关」把搜索范围收窄了不少。对照当前源码核实：

**什么虚拟化了、什么没有**

- 你找到的 `useVirtualizer`（`TurnNavigator.tsx`）是**轮导航条**——侧边约 25 个轮按钮。主对话流（`ChatFlow` → `ChatNodeSeat`）在 DOM 层面**完全没有窗口化**：已加载窗口内每个节点挂载 seat，每个轮内每个步骤也挂载。
- 真正的上界是加载窗口而非整个日志：客户端 `follow`/`loadOlder` 页请求 ≥50 条 user/assistant 消息、跨 ≥2 个 `turn/start`，上限 500 条。你的会话大概对应 500 条消息的尾部窗口——数千 DOM 节点、几百个 seat **全部常驻**，参与每一次样式/布局计算。
- `ChatNodeSeat` 已 `memo`，已结束轮不会因无关更新*重渲染*——每帧成本不在 React 协调，而在于布局/样式工作量随已挂载 DOM 规模线性增长：滚动机械（`use-chat-viewport`、`flow-motion`、锚点/分页代码）多处读 `getBoundingClientRect`/`offsetHeight`，每次读取都强制整窗布局。几百个重型 seat（markdown、代码块、工具输出）让每次强制布局都很贵——滚动/打字期间无需任何重挂载就持续掉帧，与你「与切页无关」的观察完全吻合。切页只是最坏情形（同一窗口全新挂载）。

**对四条建议**

1. *虚拟化下沉到 flow item / 步骤窗口化*——正确的长期形态，但不平凡：对话流自己的滚动机械要测节点偏移（`data-chat-paging-anchor`、轮跳转落地、历史 prepend 锚定），卸载或跳过元素必须保住测量，否则跳转和锚定坏掉。
2. *已结束轮 memo*——已实现；缺口是已挂载 DOM 上的布局成本与逐帧强制布局，不是协调。
3. *`content-visibility: auto` + `contain-intrinsic-size`*——最强的低成本候选，恰恰因为它把屏外子树移出样式/布局（持续卡顿的真正驱动），又保留可查找性。落地前有一个实测风险：跳过子树向滚动器报 intrinsic 尺寸，而 chat 的锚点/跳转机械读真实偏移——尺寸估错的跳过节点会让分页锚点或跳转落地失准。值得做一次聚焦实验；`auto`（不同于 #12563 试过的 `hidden`）不阻碍页内查找。
4. *避免重建/全量重测*——对持续卡顿，可测的目标是「每帧滚动强制布局的次数 × DOM 规模」；trace 能区分是视口机械的读占大头，还是重型内容的布局/绘制占大头。

这些都不是一行补丁——逐项窗口化、保锚点的 content-visibility、更便宜的滚动路径测量是三种不同架构，该由维护者选型。一份**滚动中**（不是切页时）的 Performance trace（样式/布局 vs 绘制 vs JS）会帮助选型；你提议的 trace 和会话规模数据确实有用。
