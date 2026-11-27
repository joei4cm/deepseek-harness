<!--
状态：草稿，未发布。
用途：Discussion #14394 的回复正文，供作者过目后决定是否发布。
说明：修复位于 fork 的 `fix/llm-pi-ai-listmodels-credential` 分支（280b13644b），未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）；报告定位与消费方行为逐条核对过，其中「resolveModelInfo 也暴露 MISSING_CREDENTIAL」一处与源码不符，见下文更正。
-->

# English reply (for posting to Discussion #14394)

Confirmed on `master` @ 4b399c39a6 — the site is exactly as reported. `listModels` swallows
`LlmError MISSING_CREDENTIAL` from `resolveApiKey` and returns `[]`, so a route with a missing key
is indistinguishable from a route with zero models, and the model catalog shows the provider as
neither a group nor a failure row.

A fix is on our fork at `fix/llm-pi-ai-listmodels-credential` (280b13644b): the enumeration lets
the rejection surface — the same failure the stream call already raises for the same route
(`prepareCall` resolves the credential without a catch, so a missing key already fails the
stream with `MISSING_CREDENTIAL`; enumeration now agrees with it).

One correction to the report: `resolveModelInfo` does not actually reach the credential — it
describes configured metadata (`modelOf` raises `NO_ADAPTER`/`INVALID_CONFIG`/`UNKNOWN_MODEL`
only), and that is deliberate, so only the stream call and now `listModels` carry
`MISSING_CREDENTIAL`. The consistency argument holds through the stream path alone.

Why propagating is safe for every current consumer (all checked on master):

- **Model catalog** (`session/modelCatalog`): `buildModelCatalog` already isolates per-provider
  failures into `failures` rows with the message, and the model picker renders them — so a
  keyless route becomes a visible "no credential for provider route …" entry instead of
  vanishing silently.
- **`modelAvailable`**: converts the rejection to `session/model-unavailable`, which now carries
  the real reason instead of "model not advertised".
- **ACP model control**: skips the provider group via its existing per-provider catch — same
  visible outcome as today's empty group.
- **subagent `list-models` tool**: reports the failure instead of "(no advertised models for …)",
  which is the correction the report asks for, and matches how `resolveModelInfo` failures
  already surface in that tool.
- **experimental translator**: `eligible()` checks `credentials.describe().configured` before it
  ever calls `listModels`, so the probe already filters a missing key; the residual race is
  contained by the existing try/catch in both the provider scan and the translation flow.
- **DeepSeek official adapter**: unaffected — its model list is config-declared with no
  credential gate.

Tests: the adapter spec's credential cases now assert the exact error propagates (the
`MISSING_CREDENTIAL` case failed against the pre-fix source and passes after — negative control);
all 23 `llm-pi-ai` test files (508 cases) pass, plus build/typecheck/lint locally.

# 中文对照（供作者参考）

在 master（4b399c39a6）上确认属实，定位与报告一致。修复在 fork 的
`fix/llm-pi-ai-listmodels-credential` 分支：`listModels` 枚举改为让同一 `LlmError` 冒泡——与流式调用对同一路由的既有行为对齐（`prepareCall` 的 `resolveApiKey` 无 catch，缺钥本就让流失败）。

对报告的一处更正：`resolveModelInfo` 实际不经过凭据解析（只描述已配置元数据，仅抛
`NO_ADAPTER`/`INVALID_CONFIG`/`UNKNOWN_MODEL`，这是有意设计），因此携带 `MISSING_CREDENTIAL` 的只有流式调用与现在的 `listModels`，一致性论证仍然成立。

传播对全部现有消费方安全（逐一核对）：模型目录既有 per-provider 失败隔离，缺钥路由变成可见的失败行；`modelAvailable` 带上真实原因；ACP 按既有 catch 跳过分组（可见结果不变）；subagent 工具从「no advertised models」变为携带 `MISSING_CREDENTIAL` 的失败；translator 在调用前已预过滤凭据；DeepSeek 官方适配器无凭据门、不受影响。

测试：适配器用例改为断言同一错误对象透传（负控在修复前源上失败）；llm-pi-ai 包 23 个文件 508 用例全绿，build/typecheck/lint 本机通过。
