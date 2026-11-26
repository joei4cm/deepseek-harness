<!--
状态：草稿，未发布。
用途：Discussion #14334 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/llm-reasoning-only-empty-response` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（8bd073392e）；两处判空站点与 207aab9d8d 的引入历史在当前代码树逐条核对过。
-->

# English reply (for posting to Discussion #14334)

Your root-cause chain checks out on current `master`, at both sites: `dsh-llm-deepseek`'s `message_stop` branch keys `EMPTY_RESPONSE` on `blocks.size === 0`, and `dsh-llm-pi-ai`'s `mapStopReason` keys it on `message.content.length === 0`. A lone reasoning block defeats both, so the retryable classification that commit 207aab9d8d established for zero-block completions never fires for reasoning-only ones — and that commit's motivation (drivers counting the no-op round) applies to reasoning-only completions identically.

One history note worth knowing before reviewing: 207aab9d8d deliberately drew the boundary as "any block counts as content" — pi-ai carries a test named `keeps a thinking-only stop successful (any block counts as content)` since that commit. Your field data is the strongest argument against that boundary: 23 intercepted completions, zero false positives, users never noticing because the guard retried silently. I implemented your exact criterion on a fork branch (`fix/llm-reasoning-only-empty-response`, based on upstream `master`):

- **Both adapters now classify a terminal `stop` without a non-whitespace text block or a tool call as `EMPTY_RESPONSE`** — reasoning-only and whitespace-only text completions reach the default retry policy (up to five attempts, 500 ms → 10 s, jittered), same as zero-block completions since July. The failed attempt's reasoning stays durably in `assistant/attempt`, outside model history, so nothing is silently lost even if every retry comes back empty.
- **Boundaries unchanged**: `max_tokens` truncation still completes (a truncated stream is not an empty reply), tool-call-carrying and text-carrying stops complete as before, and `toolUse` stop reasons never enter this branch.
- Your table of ruled-out causes needs no adapter-side counterpart: the retry policy's delays are already configurable, and the guard-plugin approach you validated is exactly what the built-in classification does now, minus the separate raw-reasoning archive (the harness keeps it in the attempt record).

The regression tests cover the criterion on both adapters — reasoning-only stop, whitespace-only stop, and the kept boundaries (reasoning+text, tool-call-only, truncated) — and fail against the pre-fix classifiers. Snapshot replay feeds harness-level chunks below the wire parsers, so recordings are unaffected; the `empty-response-retry` snapshot (zero-block scenario) passes unchanged. One unrelated observation while running the suites: `llm-pi-ai/tests/loader-composition.spec.ts` fails about half the runs with mock-server `500 script exhausted` contention on varying tests — it reproduced once with my changes reverted, and its fixtures are text-terminated, so it is pre-existing and untouched here.

The branch and a full pull-request description are ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

# 中文对照（仅供作者阅读，不发布）

你的根因链在当前 master 上两处站点都成立：`dsh-llm-deepseek` 的 `message_stop` 分支以 `blocks.size === 0` 判空，`dsh-llm-pi-ai` 的 `mapStopReason` 以 `message.content.length === 0` 判空。单个 reasoning 块让两处都失守，于是 207aab9d8d 为零块完成建立的可重试分类对 reasoning-only 永不触发——而那次提交的动机（驱动把空转轮计成正常轮）对 reasoning-only 完全同样成立。

一个评审前值得知道的历史：207aab9d8d 刻意把边界画在「any block counts as content」——pi-ai 从那个提交起就带着名为 `keeps a thinking-only stop successful (any block counts as content)` 的测试。你的现场数据是反驳这条边界最有力的证据：23 次拦截、零误报、用户全程无感（守卫静默重发）。我把你的判据原样实现在 fork 分支（`fix/llm-reasoning-only-empty-response`，基于上游 master）：

- **两个适配器现在把「无非空白 text 块且无工具调用」的终止 `stop` 归类为 `EMPTY_RESPONSE`**——reasoning-only 与纯空白 text 完成进入默认重试策略（至多 5 次，500ms → 10s，带抖动），与七月起的零块完成同一通道。失败尝试的 reasoning 持久保留在 `assistant/attempt`、模型历史之外——即使重试全空也不会静默丢失。
- **边界不变**：`max_tokens` 截断照常完成（截断不是空回复），携带工具调用或 text 的 `stop` 照常完成，`toolUse` 结束原因不进此分支。
- 你那张「试过、失败的路」表格不需要适配器侧对应项：重试策略延迟本就可配置，你验证过的守卫插件路线正是现在内置分类所做的事——只差单独存档原始 reasoning（harness 把它留在 attempt 记录里）。

回归测试在两个适配器上覆盖判据——reasoning-only stop、纯空白 stop、以及保留的边界（reasoning+text、仅工具调用、截断）——对 pre-fix 分类器失败。快照回放在 wire 解析层之下喂 harness 层 chunk，录制不受影响；`empty-response-retry` 快照（零块场景）原样通过。跑套件时一条无关观察：`llm-pi-ai/tests/loader-composition.spec.ts` 约半数运行因 mock 服务器 `500 script exhausted` 竞争失败、每次失败用例不同——还原本 PR 源码后复现过一次，且其 fixture 全部以 text 收尾，属于既有 flake，本 PR 未触碰。

分支与完整的 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。
