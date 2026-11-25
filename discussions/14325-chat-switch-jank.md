<!--
状态：草稿，未发布。
用途：Discussion #14325 的回复正文，供作者过目后决定是否发布。
说明：仅源码分析（ui-chat、session-controller），无代码改动；性能方案属架构决策。
-->

# English reply (for posting to Discussion #14325)

Thank you for the detailed report — the numbers (25 turns, ~735 messages, ~6.3 MB zstd) give a concrete scale to work against. Your analysis is largely right, with a few corrections and one important bound worth knowing, based on the current source:

**What is and isn't virtualized**

- The virtualizer you found (`useVirtualizer` in `TurnNavigator.tsx`) is the **turn rail** — the narrow rail of ~25 turn buttons on the side. The main conversation flow (`ChatFlow` → `ChatNodeSeat`) is **not** virtualized at the DOM level: every node in the loaded window mounts its seat, and within a turn every step mounts too. So your conclusion stands, but the cost driver is "every node in the loaded window," not just "every node in the visible turns."
- What bounds the cost is the **loaded window**, not the whole log: the Client's initial `follow` and each `loadOlder()` page request at least 50 user/assistant messages crossing at least two `turn/start`s, up to a 500-message cap (`session-controller` README). For your session the reopen window is likely the 500-message tail — still a few thousand DOM nodes and hundreds of `ChatNodeSeat` mounts, which matches multi-second jank.
- `ChatNodeSeat` is already `memo`'d, so settled turns don't *re-render* — but memo cannot help a *remount*, which is what switching panels causes. So your suggestion 2 lands differently than intended: the renders are already cheap; the mounts aren't.
- One wrinkle in your favor: when the last consumer facet releases, the session **shrinks to its last Turn-aligned page** and buffers the rest in memory. If the panel switch releases the chat facet, reopening does a fresh page fetch plus a full remount — the whole loaded window is thrown away and rebuilt, exactly the "avoid rebuilding the subtree" case you name.

**On the four suggestions**

1. *Sink virtualization to flow items / window the steps* — the right long-term shape, but nontrivial: the flow's own scroll machinery (`use-chat-viewport`, paging anchors, `data-chat-paging-anchor`, the turn-jump landing) measures node offsets, so unmounting or skipping items must preserve measurement or jump-to-turn and history-prepend anchoring break.
2. *Memo settled turns* — already done (`ChatNodeSeat` is `memo`); the gap is remounting, and the remedy is retention across route switches or a smaller reopen window, not more memoization.
3. *`content-visibility: auto` + `contain-intrinsic-size`* — plausible cheap win, with one real hazard to test before landing: skipped subtrees report their intrinsic size to the scroller, and the chat's scroll-anchor/jump machinery reads real offsets — an incorrectly sized skipped node could desync paging anchors or jump landings. Worth a focused experiment; note `auto` (unlike the `hidden` tried in #12563) still keeps text findable, so the find-in-page interaction is the safe half of the story and the measurement is the risky half.
4. *Avoid the full remount* — the other half of the same fix: keeping the chat surface mounted-but-hidden across panel switches (DOM retention instead of rebuild) is the architectural choice between "mount less" and "don't remount." Both end at the same measured cost.

None of these is a one-line patch; per-item windowing, content-visibility with anchor preservation, and DOM retention are three different architectures for the same second-scale problem, and the maintainers should pick the shape. A Performance trace of the long task on reopen (which mount tree dominates — seats, code blocks, or images) would help choose between them; your offered trace plus the session size data would be genuinely useful.

# 中文对照（仅供作者阅读，不发布）

感谢详细的报告——规模数据（25 轮、约 735 条消息、6.3 MB zstd）给了具体的量级。对照当前源码，你的分析大体正确，但有几处修正和一个重要上界：

**什么虚拟化了、什么没有**

- 你找到的 `useVirtualizer`（`TurnNavigator.tsx`）是**轮导航条**——侧边约 25 个轮按钮的窄轨。主对话流（`ChatFlow` → `ChatNodeSeat`）在 DOM 层面**没有**虚拟化：已加载窗口内的每个节点都挂载 seat，轮内每个步骤也挂载。所以你的结论成立，但成本驱动是「已加载窗口内的全部节点」，不只是「可见轮内的节点」。
- 成本的上界是**加载窗口**而非整个日志：客户端的初始 `follow` 与每个 `loadOlder()` 页请求至少 50 条 user/assistant 消息、跨至少两个 `turn/start`，上限 500 条消息（`session-controller` README）。你的会话重开窗口大概率就是 500 条消息的尾部——数千 DOM 节点加几百个 `ChatNodeSeat` 挂载，与数秒卡顿吻合。
- `ChatNodeSeat` 已经 `memo` 了，已结束轮不会*重渲染*——但 memo 救不了*重挂载*，而切页正是重挂载。所以你的建议 2 的实际意义有出入：渲染本来就不贵，挂载才贵。
- 还有一点对你有利：当最后一个消费者 facet 释放时，会话窗口会**收缩到最后一页**，其余转内存缓冲。如果切页释放了 chat facet，回来时就是「重新取页 + 整窗重挂载」——已加载窗口整个被丢弃重建，正是你说的「避免整树重建」情形。

**对四条建议**

1. *虚拟化下沉到 flow item / 步骤窗口化*——正确的长期形态，但不平凡：对话流自己的滚动机械（`use-chat-viewport`、分页锚点、`data-chat-paging-anchor`、轮跳转落地）要测节点偏移，卸载或跳过元素必须保住测量，否则跳转到轮和历史 prepend 锚定会坏。
2. *已结束轮 memo*——已实现；缺口在重挂载，解法是切页时保留 DOM 或缩小重开窗口，不是加 memo。
3. *`content-visibility: auto` + `contain-intrinsic-size`*——可能的低成本收益，有一个实测风险：被跳过的子树向滚动器报 intrinsic 尺寸，而 chat 的锚点/跳转机械读真实偏移——尺寸估错的跳过节点会让分页锚点或跳转落地失准。值得做一次聚焦实验；`auto`（不同于 #12563 试过的 `hidden`）不阻碍页内查找，安全的一半在查找，风险的一半在测量。
4. *避免整树重建*——同一个修复的另一半：切页时把 chat 面保留挂载、只隐藏（DOM 保留而非重建），是在「少挂载」和「不重挂」之间做的架构选择。两者收敛到同一个可测成本。

这些都不是一行补丁：逐项窗口化、保锚点的 content-visibility、DOM 保留是三种不同架构，该由维护者选型。一份重开时 long task 的 Performance trace（哪棵挂载树占大头——seats、代码块还是图片）会帮助选型；你提议的 trace 和会话规模数据确实有用。
