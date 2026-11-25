<!--
状态：草稿，未发布。
用途：Discussion #14297 的回复正文，供作者过目后决定是否发布。
说明：线程已收敛为「投影层保持 whole-log、窗口读数放插件层」；本稿说明 harness 侧已落地的方案 B 及为何窗口口径不进 harness。
-->

# English reply (for posting to Discussion #14297)

Your diagnosis is confirmed on master, and the thread has already converged on the right split, so this is only the harness-side half of it:

**The label now states the scope it actually has.** `stats.dialog.speed` read as current output speed while the number is the whole-session average (`decodeTokens / decodeMs` from the durable `sessionStats` projection, whose own types declare whole-log scope). On `fix/ui-chat-session-average-speed-label` the row is relabeled in all eight locale dictionaries — `Session-avg tokens per second (TPS)` / 「会话平均输出速度（TPS）」— matching the sibling TTFT row, and the `ui-chat` README describes the reading the same way in both languages. Numbers, computation, and the projection are untouched: no `stateVersion` bump, no persistence-change entry. Your retreat on the version bump was correct.

**The window reading stays out of the harness deliberately.** A recent-window figure needs per-step history that the whole-log projection does not carry, and folding it from the loaded nodes is unstable in a way the projection exists to avoid: a paged-in window that drops the tail would show a different number for the same session, which is exactly what "every figure rides the durable projection, so paging and compaction cannot change any of them" rules out. The pill is a replaceable dock entry by design (`ui-chat/README.md`), so a window reading belongs there — and that is the shape already shipped: a new id at `order` 2, `priority` 0, with the incremental fold (first fold walks back to eight decode-timed steps, later folds read only appended nodes, re-paged lists re-fold from the tail). If maintainers later want a window reading in the default pill, the honest route is a projection change with its version bump, not a node walk behind a stable-looking number.

One disclosure: in Compact mode the pill still shows only the bare number, since that mode renders no label — the scope wording lives in the dialog. If maintainers want the scope visible there too, that is a copy decision for the reading itself rather than the row label.

# 中文对照（仅供作者阅读，不发布）

你的根因判断在 master 上得到确认，线程也已经收敛到正确的分工，这里只补 harness 侧的那一半：

**标签现在写明它真实的口径。** `stats.dialog.speed` 读起来像当前输出速度，而数字是全会话平均（`decodeTokens / decodeMs`，来自耐久的 `sessionStats` 投影，其类型自己声明 whole-log 作用域）。`fix/ui-chat-session-average-speed-label` 上，该行标签已在全部 8 个语言字典中改写——`Session-avg tokens per second (TPS)` /「会话平均输出速度（TPS）」——与同组 TTFT 行一致；`ui-chat` README 也以同样方式描述该读数（双语）。数值、计算与投影均未改动：不升 `stateVersion`，不需要 persistence-change 记录。你在版本提升上的撤回是对的。

**窗口口径有意不进 harness。** 最近窗口读数需要 whole-log 投影不携带的逐步历史；而从已加载节点折叠在分页下不稳定——这正是投影要避免的：一个丢掉尾部的分页窗口会对同一个会话显示不同数字，而「所有数字都骑在耐久投影上，使分页与压缩都无法改变它们」这条设计正好排除它。胶囊按设计是可替换的 dock 条目（`ui-chat/README.md`），所以窗口读数属于那一层——而且已经有对应的形态落地：新 id、`order` 2、`priority` 0，配增量折叠（首次从尾部回折到 8 个带解码计时的步，后续只 fold 新增节点，重新分页的列表从尾部重新折叠）。如果维护者以后想让默认胶囊显示窗口读数，诚实的路径是带版本提升的投影变更，而不是在一个看起来稳定的数字背后走节点。

一点披露：简洁模式下胶囊仍只显示裸数字，因为该模式不渲染标签——口径措辞只存在于对话框里。如果维护者希望那里也显示口径，那是针对读数本身而非行标签的文案决定。
