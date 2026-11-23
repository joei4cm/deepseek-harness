---
description: "将 Harness 模型调用路由到默认无密钥的 OpenAI 兼容本地推理服务器。"
kind: package-reference
---

# @deepseek-ai/dsh-llm-local

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-local` 将 Harness LLM 服务直接连接到兼容 OpenAI 的本地推理服务器，例如 llama.cpp `llama-server`、LM Studio、vLLM，以及 Ollama 的 OpenAI 兼容端点。它不依赖 pi-ai 运行时，默认不发送凭据，从 `/v1/models` 发现模型，并通过 `/v1/chat/completions` 流式传输 Chat Completions。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Cordis 组合中加载 `@deepseek-ai/dsh-llm` 和此适配器。每个端点配置一个提供方路由；路由键就是模型请求中的 `provider`。

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

仅当端点需要密钥时才配置 `apiKeyEnv`。适配器会在每次操作时通过 `ctx.credentials` 或启动环境解析凭据引用，并将其作为 Bearer token 发送。省略该引用时不会发送 `Authorization` 请求头，也不会读取其他环境中的 OpenAI 密钥。`baseURL` 是 HTTP(S) API 根路径，通常以 `/v1` 结尾；适配器拒绝重定向，避免凭据被转发到其他源。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providers` | 必填 | 按 `GenerateOptions.provider` 中的路由 id 索引的提供方路由 |
| `displayName` | 路由 id | 选择器中显示的提供方名称 |
| `baseURL` | 必填 | HTTP(S) API 根路径；请求会追加 `/models` 和 `/chat/completions` |
| `apiKeyEnv` | 无 | 可选凭据引用；省略时使用无密钥请求 |
| `models` | 端点目录 | 可选的精确模型名称与容量；配置的名称优先于端点目录名称 |
| `streamIdleTimeoutMs` | `300,000` | 连接或等待 SSE 事件时的最大空闲时间 |
| `retryPolicy` | LLM 运行时默认值 | 提供方持有的重试策略 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llm-local)列出所有可接受字段及其 schema。

适配器使用 OpenAI Chat Completions 协议，并接受目录中未列出的模型 id。`listModels(provider)` 每次调用都会查询端点；`ctx.llm.resolveModelInfo(provider, model)` 只使用可选的配置元数据，不发起网络请求。可通过 `ctx.llm.discoverModels()` 使用已配置的提供方或草稿 `baseURL` 查询端点。

适配器仅支持文本输入。LLM 运行时会将图像引用投影为稳定文本。文本、系统提示、工具声明、助手工具调用历史、工具结果、流式推理增量、流式函数调用、用量、停止序列和输出限制都会映射到 Chat Completions。适配器不会声明模型专属推理控制、图像输入、响应格式或非流式请求支持。

<a id="model-experience"></a>
## 模型体验

### 本地推理请求

#### 模型看到什么

选定的端点会以 OpenAI 兼容的流式 Chat Completions 请求收到配置的模型 id、系统与对话文本、工具 schema，以及受支持的请求控制项。可选的一次性系统提示位于消息历史之前；Harness developer 消息会映射为 system 角色。助手推理历史以 `reasoning_content` 发送，助手工具调用保留原始 JSON 参数，工具结果保留调用 id。由于路由声明仅支持文本输入，图像引用会以 Harness 生成的文本形式到达端点。

#### Token 影响

本地模型的 tokenizer 决定精确用量；端点返回提示词和生成 token 数时，适配器会按原值保留。配置的模型容量影响准入和选择器，不决定 token 计数。

#### KV Cache 影响

适配器保留投影后的消息顺序，不添加提示词文本。端点、模型、消息或工具 schema 的变化可能改变提供方可复用的前缀。本地缓存分配和淘汰由端点负责。

### 本地推理响应

#### 模型看到什么

Harness 会收到流式推理、文本和原始字符串函数参数，随后是提供方用量和一个终止原因。适配器要求 SSE `[DONE]` 标记，并在工具分发前拒绝格式错误的工具参数。

#### Token 影响

报告的提示词和生成 token 数遵从提供方响应。缺失或无效的用量计数会被省略；只有 Agent Loop 记录的生成内容会进入后续请求。

#### KV Cache 影响

后续请求只包含 Session 日志保留的响应内容。传输事件、用量和终止元数据不会增加模型可见的前缀文本。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不同 OpenAI 兼容服务器的行为和聊天模板各异** — 适配器发送标准 Chat Completions 字段，不协商供应商专属的推理或模板控制项。
- **模型目录按需读取** — 端点不可用时，`listModels()` 会失败而不是返回过期缓存；配置的模型元数据仍可用于精确请求。
- **本地提供方设置由组合配置管理** — 端点路由和凭据在插件配置中设置；适配器不提供专属的 Models 页面编辑器。
- **不会发送图像或模型专属推理控制项** — 请使用支持图像的适配器或保持文本输入的服务器；适配器不会通过兼容标志静默丢弃不支持的选项。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
