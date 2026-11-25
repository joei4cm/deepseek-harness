<!--
状态：草稿，未发布。
用途：Discussion #14328 的回复正文，供作者过目后决定是否发布。
说明：未定位根因；回复给出已有的分层计时通道（session-stats 投影、durable `llm/retry` 事件、OTel 脱敏通道的限制），以及读数如何区分四种假设。
-->

# English reply (for posting to Discussion #14328)

A timing channel that separates exactly the three spans you named already exists — two of them, actually:

**1. The durable Session log carries every event with `seq` + `time`, content-free by construction if you only read metadata.** The pairs you want are already durable records: `step/start` → `assistant/message` bounds each model request (its duration is request wall time), `tool/call` → `tool/result` bounds each tool wait, and — the one that often explains a 2–3× inflation invisible in the UI — `dsh-llm-retry` appends `llm/retry` (with provider, failure code, and scheduled delay) and `llm/retry-started` *before* each backoff. On a flaky or rate-limited route, normal-mode retries can add several requests per step with up to 10 s of backoff each; from the model's side the turn looks identical, from the log's side the extra seconds are explicit. Shipped profiles persist one `session.jsonl.zstd` per session under the configured persistence root (`dsh-session-persistence-jsonl`); you can decode it (`zstd -d`) and read only `type`/`time`/`seq` — no prompt or tool content required.

**2. The assembled `sessionStats` projection already folds the aggregate view you would compute by hand**: `llmMs` (summed model wall time per request), `toolMs` (summed tool call→result time), `ttftMs`/`ttftSteps` (mean time-to-first-token), and `decodeMs`/`decodeTokens` (whole-log speed). The Web UI's activity-pill dialog shows LLM time, tool time, mean TTFT, and session-average TPS from it; per-Turn usage rows cover the token side.

Four readings separate the hypotheses:

- **step/turn ratio** — if a one-Skill turn opens noticeably more steps than the comparator, the gap is orchestration (extra round trips, more tool calls, or retries — check for `llm/retry` rows).
- **llmMs dominant with similar TTFT** — per-request time is the gap, i.e. a slower stream, larger prompts, or a non-streaming route; TTFT + decode time together say which half.
- **toolMs dominant** — the gap sits in tool/execution serialization, not the provider.
- **wall minus (llmMs + toolMs)** — a remainder is scheduling, persistence, or serialization between requests, none of which the provider sees.

Two caveats on completeness. There is no per-request latency export to the wire as a first-class trace today — the OTel channel (`dsh-session-telemetry-otel`) emits content-free `session-log` records with `seq`/`time`, but it is feedback-gated (capture is authorized by an explicit feedback event), so it is not a general trace. And "time to first token" in the projection measures step-start → first assembled `assistant/message`, which for a buffered provider response equals total request time — so a high TTFT-plus-zero-decode pattern would specifically mean the route is not streaming.

If you can attach a redacted per-step timing summary for one slow run (event `type`/`time` rows only — no `data` needed beyond step/tool correlation, and the `llm/retry` payload's failure code), it turns "2–3×" into a localized bucket, which is what a fix would need.

# 中文对照（仅供作者阅读，不发布）

你点名的三段计时（首个请求前、等 provider、工具调用之间）已经有现成的通道可分开——其实是两条：

**1. 耐久 Session 日志里的每个事件都带 `seq` + `time`，只读元数据时天然无内容。** 你需要的几对边界都已经是耐久记录：`step/start` → `assistant/message` 圈住每次模型请求（即单次请求墙钟），`tool/call` → `tool/result` 圈住每次工具等待；而最能解释 UI 里看不见的 2–3 倍膨胀的是——`dsh-llm-retry` 会在每次退避**之前**写入 `llm/retry`（含 provider、失败码、计划延迟）和 `llm/retry-started`。路由抖动或限流时，normal 模式的重试每步可能多加数次请求、每次退避最多 10 秒；模型侧回合完全一致，日志侧多出的秒数却是显式的。已发货 profile 每个 session 在配置的持久化根目录下写一份 `session.jsonl.zstd`（`dsh-session-persistence-jsonl`），`zstd -d` 解开后只读 `type`/`time`/`seq` 即可——不需要 prompt 或工具内容。

**2. 组装好的 `sessionStats` 投影已经把你手算要折的聚合折好了**：`llmMs`（每次模型请求墙钟之和）、`toolMs`（工具 call→result 之和）、`ttftMs`/`ttftSteps`（平均首 token 延迟）、`decodeMs`/`decodeTokens`（全会话速度）。Web 端 activity 胶囊的对话框直接从它显示 LLM 耗时、工具耗时、平均 TTFT、会话平均 TPS；token 侧有每轮用量行。

四类读数区分假设：

- **step/turn 比**——单个 Skill 回合开的 step 明显多于对照组，缺口在编排（多回合、更多工具调用或重试——查 `llm/retry` 行）。
- **llmMs 占优而 TTFT 接近**——差在单请求耗时，即流式更慢、prompt 更大或路由非流式；TTFT 与 decode 耗时合起来能分辨是哪一半。
- **toolMs 占优**——缺口在工具/执行序列化而非 provider。
- **wall − (llmMs + toolMs) 余量**——剩余部分在请求之间的调度、持久化或序列化，provider 完全看不到。

两点完整性披露：目前没有把每次请求延迟作为一等 trace 导出到线上——OTel 通道（`dsh-session-telemetry-otel`）发的是无内容的 `session-log` 记录（带 `seq`/`time`），但它由显式反馈事件授权（feedback-gated），不是通用 trace；投影里的「首 token」度量的是 step-start → 首个 `assistant/message`，缓冲式 provider 响应时它等于整次请求耗时——所以「TTFT 很高而 decode 几乎为零」的模式恰好意味着该路由不走流式。

如果你能给一次慢运行的脱敏逐步计时摘要（只要事件的 `type`/`time` 行——除 step/tool 关联和 `llm/retry` 的失败码外不需要 `data`），就能把「2–3 倍」落成某个具体的桶，这是任何修复需要的起点。
