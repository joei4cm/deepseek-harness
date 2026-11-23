## Motivation

Harness 目前只能通过 `dsh-llm-pi-ai` 走向云端提供方。想在本机跑模型的用户必须自己把 Ollama、llama.cpp、LM Studio 或 vLLM 的 OpenAI 兼容端点包装成一个「像云端一样的」提供方，Harness 侧没有开箱可用的本地推理路由；测试侧同样缺少一个可复用的 OpenAI 兼容 HTTP/SSE 服务器，本地端点的行为只能靠真实服务器复现。

本 PR 增加一个不依赖 pi-ai 的 first-class 本地推理适配器 `@deepseek-ai/dsh-llm-local`：默认无密钥、从 `/v1/models` 发现模型、把 OpenAI Chat Completions 流翻译成 Harness 的 chunk 词汇；同时在 `dsh-llm-mock-server` 里增加可复用的 OpenAI 兼容 mock，并在 Intel 平台上用 llama.cpp + Qwen3.5 GGUF 做过真实推理验证。

（本条目暂无对应的上游 Discussion。）

## Changes

**Interface changes**

- 新增包 `@deepseek-ai/dsh-llm-local`：函数式插件，`name` 为 `llm-local`，`inject` 为 `['llm']`，公开导出 `Config`、`LocalModelProfile`、`LocalProviderProfile`。
- 配置 `providers`：每个键就是模型请求里 `provider` 字段选择的路由；字段为 `baseURL`（必填）、`displayName`、`apiKeyEnv`、`models`（`id` / `name` / `contextWindow` / `maxTokens`）、`streamIdleTimeoutMs`（默认 `300000`）、`retryPolicy`。
- `@deepseek-ai/dsh-llm-mock-server` 新增 `startMockOpenAiServer(options)`，以及 `MockOpenAiServer`、`MockOpenAiServerOptions`、`MockOpenAiModel`、`MockOpenAiCompletion`、`MockOpenAiRequestRecord` 类型。

**Behavior changes**

- 每条配置的路由注册为 LLM runtime 的一个 provider 路由，`listProviders()` 列出路由 id 与展示名；路由在插件卸载时随之注销。
- 默认无密钥：未配置 `apiKeyEnv` 时请求不带 `Authorization` 头，也不读取环境里无关的 OpenAI 密钥；配置后按凭证引用逐次解析并以 Bearer 发送，引用非法或取值缺失在发出请求前失败。
- 模型发现：`listModels(provider)` 每次读取端点的 `/v1/models`；`resolveModelInfo(provider, model)` 只使用配置的元数据，不发网络请求；`ctx.llm.discoverModels()` 既接受已配置路由，也接受草案 `baseURL`。
- 配置里的 `models` 覆盖端点返回的展示名与容量；端点没给出名字时用模型 id 作为名字。
- 请求：`POST {baseURL}/chat/completions`，SSE 流式返回；system 提示、对话文本、工具 schema、assistant 的 reasoning 历史（`reasoning_content`）、工具调用与工具结果按 OpenAI Chat Completions 字段映射；`stop` 为空数组时拒绝（没有端点能兑现空 stop 序列）。
- 响应：`reasoning_content` 归入 reasoning 块，`content` 归入文本块，`tool_calls` 归入工具调用块（参数增量拼接，id 变化视为畸形响应），usage 归入 token 统计，`finish_reason` 归入终止原因；流必须以 `[DONE]` 结束。
- 失败映射：401/403 → `AUTH`；402 与 quota 措辞 → `QUOTA`；上下文超限措辞 → `CONTEXT_WINDOW_EXCEEDED`；429 → `RATE_LIMIT`；其余 4xx → `INVALID_REQUEST`；5xx → `SERVER`；传输失败 → `TRANSPORT`；空闲超时 → `TIMEOUT`；调用方取消 → `ABORTED`；HTTP 状态与 `Retry-After` 一起保留在失败详情里。
- 边界：目录与错误体读取有字节上限，超限按读取失败处理；重定向被拒绝（`redirect: 'error'`），凭证不会随重定向流向别的源；`baseURL` 必须是绝对 HTTP(S) 地址且不带内嵌凭证、查询串或片段。
- 文本通道：图像输入、模型特定推理控制、response format 与非流式请求不提供；图像引用由 LLM runtime 投影为文本后送入。
- mock server：`/v1/models` 无密钥可用（配置 `apiKey` 时精确校验 Bearer），`/v1/chat/completions` 分片输出 content、reasoning、tool_calls 与 usage，非法或超过 1 MiB 的请求体 → 400，未知路由 → 404。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-llm-local` | OpenAI 兼容本地推理路由的 LLM 适配器 | 新增：路由注册、模型发现、Chat Completions 流翻译 |
| `dsh-llm-mock-server` | LLM 恢复测试用的可脚本化 HTTP/SSE 故障服务器 | 变更：新增 OpenAI 兼容模型目录与 Chat Completions 端点 |

依赖边：`dsh-llm-local` 只依赖 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-brand` 与 `eventsource-parser`，不引入 `dsh-llm-pi-ai`；`dsh-llm-mock-server` 不新增依赖。

调用流程：

```text
model request (provider: 'intel-local', model: 'qwen-local')
  → llm-local: resolve route facts (baseURL, credential reference, model metadata)
  → GET {baseURL}/models → bounded catalog read → LlmDiscoveredModel[]
  → POST {baseURL}/chat/completions (streaming SSE)
  → readChatStream → block-start / text-delta / tool-call-delta / block-end / usage / finish
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 无密钥的模型目录 | 不发送 `Authorization`，配置名覆盖端点名 | `lists models keylessly and overlays configured selector metadata` |
| 无密钥的流式请求 | 文本、用量、工具调用翻译成 Harness 词汇 | `streams text, usage, and a function call through the harness vocabulary` |
| 显式配置的密钥 | 以 Bearer 发送，HTTP 失败保留状态 | `sends an explicitly configured API key and reports HTTP status failures` |
| 目录别名与非法项 | 归一化别名、跳过非法 id、草案 `baseURL` 一次性密钥 | `normalizes model catalog aliases, skips invalid ids, and uses a one-shot draft key` |
| 目录读取失败 | 畸形、超限、不可达 → 稳定错误码 | `rejects malformed, oversized, and unreachable catalogs with stable failures` |
| HTTP 失败矩阵 | 状态码映射到 AUTH/QUOTA/RATE_LIMIT/INVALID_REQUEST/SERVER，保留 `Retry-After` | `maps HTTP failures, request ids, and Retry-After values` |
| 凭证引用 | 非法环境变量名、缺失与非法取值在请求前失败 | `validates credential references and values before sending requests` |
| 流式失败 | 传输、HTTP、空体、畸形 SSE、取消、空闲超时 → finish chunk | `converts transport, HTTP, empty-body, malformed-SSE, abort, and idle failures to finish chunks` |
| 错误体过大或损坏 | 保留 HTTP 状态 | `keeps the HTTP status when the failure body is oversized or broken` |
| 目录读取期间的取消 | 上报 `ABORTED` | `reports caller cancellation while a listing body is read` |
| 路由事实 | 直接回答路由信息，未知路由失败，空配置目标拒绝 | `answers route facts directly and refuses unknown routes` |
| SSE 帧翻译 | 重复 text delta 合并，usage 细节与 finish 原因映射 | `merges repeated text deltas and reads optional usage details` |
| 帧结构异常 | 非对象事件、choice、未知 finish_reason 被拒绝 | `rejects non-object events, choices, and unsupported finish reasons` |
| 带内错误与非主 choice | 跳过非主 choice，带内错误后不再翻译后续帧 | `skips non-primary choices and frames after an in-band error` |
| 工具调用完整性 | 缺 index/id、id 变更、参数非对象被拒绝；名字晚到仍可开块 | `rejects incomplete and changed tool calls and non-object tool arguments`、`starts a tool call before its function name arrives` |
| 消息映射 | system 文本、工具结果、reasoning 历史进入 chat 消息 | `maps request-only system text, tool results, and assistant reasoning to chat messages` |
| 文本通道限制 | 二进制块与空 stop 序列被拒绝 | `rejects binary blocks that reach a local text-only endpoint`、`rejects empty stop sequences that no endpoint can honor` |
| 真实 Loader 组合 | cordis.yml 装载、发现模型、流式请求、卸载后移除路由 | `loads cordis.yml, discovers the local model, streams a request, and disposes its route` |
| mock server 端点 | 无密钥模型列表、Bearer 校验、分片 completion、400/404 | `advertises models keylessly at the standard endpoint`、`requires an exact Bearer key and streams captured Chat Completions`、`omits absent model metadata and serves a default keyless completion`、`streams a tool-only completion with inferred reason and default usage`、`rejects invalid and oversized request bodies and unknown routes`、`validates its own options and advertises an IPv6 listener` |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `lists models keylessly and overlays configured selector metadata` | 目录读取、配置名覆盖、无 `Authorization` 头 |
| `streams text, usage, and a function call through the harness vocabulary` | 文本块、用量、工具调用块的完整翻译 |
| `resolves configured model capacities and keeps unknown models requestable` | 配置容量生效，未列出的模型仍可请求 |
| `supports standalone endpoint discovery without credentials` | 草案 `baseURL` 的独立发现 |
| `sends an explicitly configured API key and reports HTTP status failures` | Bearer 密钥与 HTTP 状态保留 |
| `rejects route and URL configuration errors before registration` | 空路由集、非法 `baseURL`、重复模型 id |
| `normalizes model catalog aliases, skips invalid ids, and uses a one-shot draft key` | 目录别名归一化与非法项跳过 |
| `uses model ids when endpoint names are absent and overlays configured names` | 无名模型回落到 id |
| `rejects malformed, oversized, and unreachable catalogs with stable failures` | 目录读取的稳定失败 |
| `maps HTTP failures, request ids, and Retry-After values` | 失败矩阵与重试提示 |
| `validates credential references and values before sending requests` | 凭证解析时机 |
| `converts transport, HTTP, empty-body, malformed-SSE, abort, and idle failures to finish chunks` | 流式失败的统一收敛 |
| `maps in-band HTTP and empty stream outcomes through the adapter` | 上下文超限与空响应的失败块 |
| `keeps the HTTP status when the failure body is oversized or broken` | 错误体不可读时状态仍权威 |
| `preserves the bounded-read outcome when stream cancellation refuses` | 取消被拒时读取结果仍生效 |
| `reports caller cancellation while a listing body is read` | 读取期间的调用方取消 |
| `validates discovery endpoints and interrogates a configured route` | 发现目标的地址校验与路由发现 |
| `answers route facts directly and refuses unknown routes` | 路由信息与未知路由 |
| `applies defaults to direct configuration and rejects malformed ids` | 默认值与配置校验 |
| `streams text and usage, then ends once after [DONE]` | 基本 SSE 帧序与终止标记 |
| `rejects malformed events, invalid tool arguments, missing finish reasons, and missing [DONE]` | 流结构的硬性要求 |
| `maps in-band errors and content-filter finish reasons` | 带内错误与内容过滤终止原因 |
| `merges repeated text deltas and reads optional usage details` | 文本合并与用量明细 |
| `skips non-primary choices and frames after an in-band error` | 多 choice 与错误后的帧 |
| `rejects non-object events, choices, and unsupported finish reasons` | 帧结构校验 |
| `rejects incomplete and changed tool calls and non-object tool arguments` | 工具调用完整性 |
| `starts a tool call before its function name arrives` | 工具名晚到的分片 |
| `maps request-only system text, tool results, and assistant reasoning to chat messages` | 请求侧消息映射 |
| `omits reasoning_content for plain assistant turns and drops unknown plugin blocks` | 无 reasoning 的 assistant 与未知块 |
| `rejects binary blocks that reach a local text-only endpoint` | 文本通道的输入限制 |
| `rejects empty stop sequences that no endpoint can honor` | 空 stop 序列 |
| `loads cordis.yml, discovers the local model, streams a request, and disposes its route` | 真实 Loader 组合的完整生命周期 |
| `advertises models keylessly at the standard endpoint` | mock 的模型目录 |
| `requires an exact Bearer key and streams captured Chat Completions` | mock 的鉴权与请求记录 |
| `omits absent model metadata and serves a default keyless completion` | mock 的缺省元数据与缺省回复 |
| `streams a tool-only completion with inferred reason and default usage` | mock 的纯工具调用回复 |
| `rejects invalid and oversized request bodies and unknown routes` | mock 的请求体上限与未知路由 |
| `validates its own options and advertises an IPv6 listener` | mock 的选项校验与 IPv6 监听 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/llm/llm-local packages/test-support/llm-mock-server
  Test Files  8 passed (8)
  Tests  109 passed (109)

pnpm exec vitest run --coverage \
  --coverage.include='packages/llm/llm-local/src/**/*.{ts,tsx}' \
  --coverage.include='packages/test-support/llm-mock-server/src/**/*.{ts,tsx}' \
  packages/llm/llm-local packages/test-support/llm-mock-server
  Statements   : 100% ( 838/838 )
  Branches     : 100% ( 654/654 )
  Functions    : 100% ( 113/113 )
  Lines        : 100% ( 735/735 )

pnpm run typecheck
  run-gates: 5 passed, 0 failed, 0 skipped in 18.25s

pnpm run lint
  exit 0
```

**Intel 平台实机验证**

硬件：Intel Core Ultra 9 285H（3 个可用核心，30GB 内存）。推理端点为 llama.cpp 的 `llama-server`，version 1.0.0-dev build 12633（GNU 11.4.0, x86_64）：

```
llama-server --host 127.0.0.1 --port 18080 \
  -m ~/.lmstudio/models/lmstudio-community/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q4_K_M.gguf \
  -c 4096 -t 3 --jinja
```

该端点的 `/v1/models` 同时返回 Ollama 风格的 `models` 与 OpenAI 风格的 `data`；适配器读取 `data`，模型 id 是完整的 GGUF 文件路径。用真实 `LlmRuntime` 加本插件路由到该端点后的观察结果：

- `listProviders()`、`listModels('local')`、`resolveModelInfo('local', model)`、`discoverModels('llm-local', { provider: 'local' })` 全部成功。
- 文本请求：流出 126 个 reasoning delta，随后是文本块结束 `"cable"`；用量为 `{ inputTokens: 23, outputTokens: 126, totalTokens: 149 }`，终止原因为 `{ kind: 'stop' }`。
- 工具请求：流出 reasoning 块与工具调用块 `{ id: 'cCNbv4vvyAolsccXHyDkmix5FeRQb7Ry', name: 'get_weather', arguments: '{"city":"Paris"}' }`，终止原因为 `{ kind: 'tool-calls' }`。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent scoped the work to a keyless-by-default OpenAI-compatible local route plus a reusable mock server; the author selected this topic from the Agent's list of candidate features. |
| design 方案设计 | auto 模型自主 | 90% | The Agent chose a standalone adapter package without a pi-ai dependency, `/v1/models` discovery, the OpenAI Chat Completions wire format, and a bounded catalog read; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent set the case matrix and wrote all 37 unit tests plus the Loader composition test; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the adapter, the stream translation, the configuration, the mock server endpoints, the tests, both README revisions, the locale metadata, and the regenerated derived documentation. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
