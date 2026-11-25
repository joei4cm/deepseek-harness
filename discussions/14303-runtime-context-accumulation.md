<!--
状态：草稿，未发布。
用途：Discussion #14303 的回复正文，供作者过目后决定是否发布。
说明：对照 dsh-v0.2.1-rc.5 与 master 源码；快照累积是 append-only 设计（保 KV-cache 前缀），「完全相同的副本」需要字节级 diff 复核。
-->

# English reply (for posting to Discussion #14303)

Excellent evidence chain. Checked against both your build (`0.2.1-rc.5`) and master — three findings, one of which changes the likely root cause:

**1. Superseded snapshots accumulate under the current append-only design.** `runtime-context` messages are appended with `surfaceOp: 'append'`, never replaced: the surface keeps every snapshot so the request history's *prefix* stays byte-stable. `deriveMessages()` derives request history from the surface, so replacing an old snapshot would rewrite history and invalidate the KV cache on every step — given your reported 98.5% cache hit, eviction could increase uncached input costs; the actual tradeoff needs measurement. Appending is the deliberate choice; the `supersedes` prose is what tells the model the newest one wins. So "should old snapshots be removed from the request" is a cache-invalidation decision, not a cleanup bug.

**2. Identical snapshots are not re-committed — and the dedupe exists in your build too.** In `0.2.1-rc.5`, `RuntimeContextProjection.project` already skips when `retained?.text === snapshot`; master strengthens it to a `deepEqualJson` compare of the structured `sections`, and the regression tests cover a *fresh* projection after resume (`new RuntimeContextProjection(...).project(sections) === undefined`). Repeated byte-identical snapshots without an intervening change should therefore be deduplicated; alternating sections or retained-state invalidation are possibilities to check. The context browser labels them by seq (`T2488 S7`) and you checked that the leading persona text matches; one contributor rendering a volatile tail line (a timestamp, queue/inbox count, policy or depth state — `working-directory`, `approval:policy`, subagent depth and similar contexts all contribute per-step values) differs enough to defeat dedupe while looking identical in the browser. A byte diff of two adjacent copies would settle it: `git diff` the two `runtime-context` payloads, or compare `source.sections` in the context browser's raw view. That diff, not the count, is the real question — if a section carries per-step jitter, the fix is pinning that contribution to the value the model actually needs, which is a real actionable bug.

**3. The 4× injection log is consistent with normal evaluation, not duplication.** Per step, `prepareRequest` and `refreshContext`/`renderContextSections` evaluate `text()` more than once (assembly, snapshot render, and section list are separate passes; retries repeat them). The plugin sees every evaluation — it does not mean four snapshots were committed. `systemPrompt.context()` contract doesn't promise one `text()` call per request.

So the actionable remainder is narrow: are the copies byte-identical or not? If identical → a dedupe regression we'd want to see; if differing → which section jitters per step, and pinning it is a small deterministic fix. Either way the durable accumulation itself is the cache-prefix tradeoff, so the "fix" for token cost is preventing unnecessary *new* snapshots, not removing old ones.

# 中文对照（仅供作者阅读，不发布）

证据链很扎实。对照了你的构建（`0.2.1-rc.5`）与 master——三点结论，其中一条改写了最可能的根因：

**1. 当前的追加式设计会累积被取代的快照。** `runtime-context` 消息一律以 `surfaceOp: 'append'` 追加、从不替换：surface 保留每份快照，使请求历史的*前缀*字节稳定。`deriveMessages()` 从 surface 推导请求历史，替换旧快照会重写历史并使每步的 KV 缓存失效——根据你报告的 98.5% 命中率，剔除旧快照可能增加未缓存输入成本；实际取舍需要测量。追加是刻意的选择；`supersedes` 措辞是告诉模型最新的一份生效。所以「该不该把旧快照从请求里剔除」是缓存失效问题，不是清理 bug。

**2. 相同快照不会重复提交——而且去重在**你的**构建里就存在。** `0.2.1-rc.5` 的 `RuntimeContextProjection.project` 已经在 `retained?.text === snapshot` 时跳过；master 强化为对结构化 `sections` 的 `deepEqualJson` 比较，回归测试还覆盖了 resume 后新建投影的情形（`new RuntimeContextProjection(...).project(sections) === undefined`）。因此没有中间变化的连续字节相同快照应被去重；section 交替变化或 retained 状态失效也是需要检查的可能性。上下文浏览器按 seq（`T2488 S7`）标注，你核对的是开头的人设正文；只要某个贡献项在尾部渲染易变行（时间戳、队列/inbox 计数、策略或深度状态——`working-directory`、`approval:policy`、subagent 深度等 context 都会贡献随步变化的值），就足以让去重失效，而在浏览器里看起来一模一样。对相邻两份做字节 diff 即可定论：比对两份 `runtime-context` 负载，或在浏览器原始视图里比 `source.sections`。真正的问题是那个 diff 而不是数量——如果某 section 带每步抖动的值，把该贡献钉到模型真正需要的值上就是一个可修的小 bug。

**3. 4 次注入日志与正常求值一致，不是重复。** 每步 `prepareRequest` 与 `refreshContext`/`renderContextSections` 会不止一次求值 `text()`（assembly、快照渲染、section 列表是分开的 pass；重试再叠加）。插件看到的是每次求值——不等于提交了四份快照。`systemPrompt.context()` 契约不承诺每请求一次 `text()` 调用。

所以可行动的余量很窄：副本是否字节相同？相同→这是我们想看的去重回归；不同→哪个 section 每步抖动，钉住它就是一个小而确定的修复。无论哪种，持久累积本身是缓存前缀取舍，省 token 的「修法」是阻止不必要的*新*快照，而不是移除旧快照。
