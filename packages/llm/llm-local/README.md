---
description: "Route Harness model calls to keyless-by-default OpenAI-compatible local inference servers."
kind: package-reference
---

# @deepseek-ai/dsh-llm-local

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-local` connects the Harness LLM service directly to OpenAI-compatible local inference servers such as llama.cpp `llama-server`, LM Studio, vLLM, and Ollama's OpenAI-compatible endpoint. It has no pi-ai runtime dependency, sends no credential by default, discovers models from `/v1/models`, and streams Chat Completions from `/v1/chat/completions`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-llm` and this adapter in a Cordis composition. Add one provider route per endpoint; each route key is the `provider` passed in model requests.

```yaml
- name: '@deepseek-ai/dsh-llm'
- name: '@deepseek-ai/dsh-llm-local'
  config:
    providers:
      llama-local:
        displayName: Local llama.cpp
        baseURL: http://127.0.0.1:8080/v1
        streamIdleTimeoutMs: 300000
        models:
          - id: Qwen3.5-9B-Q4_K_M.gguf
            name: Qwen 3.5 9B (Q4_K_M)
            contextWindow: 32768
            maxTokens: 8192
```

Configure `apiKeyEnv` only when the endpoint requires a key. The adapter resolves that credential reference for every operation through `ctx.credentials` or the launch environment and sends it as a Bearer token. An omitted reference sends no `Authorization` header and never consults unrelated ambient OpenAI keys. `baseURL` is an HTTP(S) API root, typically ending in `/v1`; redirects are refused so a credential cannot move to another origin.

| Field | Default | Meaning |
|---|---|---|
| `providers` | required | Provider routes keyed by the id selected in `GenerateOptions.provider` |
| `displayName` | route id | Provider label shown by selectors |
| `baseURL` | required | HTTP(S) API root; requests append `/models` and `/chat/completions` |
| `apiKeyEnv` | absent | Optional credential reference; absent means keyless requests |
| `models` | endpoint catalog | Optional exact-model labels and capacities; configured labels override endpoint-discovered names |
| `streamIdleTimeoutMs` | `300,000` | Maximum idle time while connecting or waiting for one SSE event |
| `retryPolicy` | LLM runtime default | Provider-owned retry behavior |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llm-local) lists every accepted field and its schema.

The adapter uses the OpenAI Chat Completions wire format and accepts unlisted model ids. `listModels(provider)` queries the endpoint on each call; `ctx.llm.resolveModelInfo(provider, model)` uses only the optional configured metadata and does not make network requests. Endpoint discovery accepts a configured provider or a draft `baseURL` through `ctx.llm.discoverModels()`.

The adapter is text-only. The LLM runtime projects image references to stable text for this route. Text, system prompts, tool declarations, assistant tool-call history, tool results, streamed reasoning deltas, streamed function calls, usage, stop sequences, and output limits map to Chat Completions. Model-specific reasoning controls, image input, response formats, and non-streaming requests are not advertised.

<a id="model-experience"></a>
## Model Experience

### Local inference request

#### What the model sees

The selected endpoint receives the configured model id, system and conversation text, tool schemas, and supported request controls as an OpenAI-compatible streaming Chat Completions request. An optional one-shot system prompt precedes message history; Harness developer messages use the system role. Assistant reasoning history is sent as `reasoning_content`, assistant tool calls retain their raw JSON arguments, and tool results retain their call ids. Image references arrive as Harness-generated text because the route declares text input only.

#### Token effect

The local model's tokenizer determines exact usage; when the endpoint returns prompt and completion counts, the adapter preserves them as reported. Configured model capacities affect admission and selectors, not tokenization.

#### KV Cache effect

The adapter preserves the projected message order and does not add prompt text. Endpoint, model, message, or tool-schema changes can change the provider's reusable prefix; local cache allocation and eviction remain endpoint-owned.

### Local inference response

#### What the model sees

The Harness receives streamed reasoning, text, and raw-string function arguments followed by provider usage and one terminal finish reason. The adapter requires the SSE `[DONE]` marker and rejects malformed tool arguments before tool dispatch.

#### Token effect

Reported prompt and completion counters follow the provider response. Missing or invalid usage counters are omitted; generated content affects later requests only after the agent loop records it.

#### KV Cache effect

The next request includes only response content retained in the Session log. Transport events, usage, and finish metadata do not add model-visible prefix text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **OpenAI-compatible behavior varies by server and chat template** — the adapter sends standard Chat Completions fields and does not negotiate vendor-specific reasoning or template controls.
- **The model catalog is read on demand** — an unavailable endpoint makes `listModels()` fail instead of returning a stale cached catalog; configured model metadata remains usable for exact requests.
- **Local provider settings are composition-owned** — endpoint routes and credentials are set in the plugin configuration; the adapter does not add a dedicated Models-page editor.
- **Images and model-specific reasoning controls are not sent** — use an image-capable adapter or a server whose request remains text-only; no compatibility flags silently discard unsupported options.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
