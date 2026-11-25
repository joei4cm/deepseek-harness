## Motivation

#14265 报告：`llm-pi-ai/request-headers` 允许插件向推理调用贡献标头，但模型发现（`GET {baseURL}/models`）在 `discovery.ts` 里自建请求，没有对应的扩展点。一个端点若需要请求时生成的标头——轮换的企业代理令牌、签名请求 id、短生命周期的 OIDC 断言——推理能鉴权而配置期探测不能：Models 页面的「获取可用模型」对同一路由返回 401，而 composer 里的同一路由正常工作。

排查确认这恰是提案描述的位置：`discoverModels` 是端点探测的唯一出口，它按协议组装自己的 `Headers`（`accept`、协议凭据、`attributionHeaders`），`request-headers` waterfall 只存在于 `PiAiAdapter.requestHeaders` 推理路径上。两条路径的排序规则一致：贡献器在部署标头与已解析凭据之后、Harness 应用标识之前运行，应用标识始终获胜。

提议者自带分支（`poyarkoff/deepseek-harness` 的 `feat/llm-pi-ai-discovery-headers`，含测试），与提案描述一致；本 PR 按同一语义在 fork 上落地，接口命名与提案完全相同。

Refs #14265

## Changes

**Interface changes**

- `Events` 新增 `'llm-pi-ai/discovery-headers'` waterfall：监听器契约与 `request-headers` 相同（同步、必须 `next()`、不得保留标头集）；`request` 为 `PiAiDiscoveryHeaderContext`（`provider`、`baseURL`、`api`）。
- `discoverModels()` 签名扩展第三参 `prepareHeaders(request, headers) => Headers`（可选），调用点与推理 `requestHeaders` 同一位置：凭据设置之后、`attributionHeaders()` 之前。
- `PiAiDiscoveryHeaderContext` 新类型（`types.ts`），`index.ts` 再导出；`scripts/gen-cordis-catalog.ts` `LINK_MAP` 登记到 `llm-streaming.md`，cordis-catalog/doc-graphs 生成物随之更新。

**Behavior changes**

- 发现探测走到网络时：部署标头 + 协议凭据就绪 → 调用 contributor 链 → 应用标识写入 → `fetch`。Catalog 路由、非 wire 探测、`DISCOVERY_UNSUPPORTED` 短路均不触发。
- 贡献器抛 `LlmError` 保留其 code（例如 `REQUEST_HEADERS`）；其他抛出折叠为 `DISCOVERY_FAILED`（与推理侧 `requestHeaders` 的策略同型：非 TypeError 公开消息、非 Error 值为安全文案）。
- 准备阶段抛错时探测不发出：HTTP 层在此之前从未被调用。
- `request-headers` 规格新增一例 `purpose: 'session-title'` 调用，补上此前未覆盖的可选属性分支（`options.purpose === undefined` 的另一侧），无行为变化。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-llm-pi-ai` | pi-ai 推理适配器 + 模型发现 | 变更：发现路径新增 contributor 钩子；发现上下文类型 |
| `dsh-typert-generator` / `scripts` | cordis-catalog 生成物 | 机械：LINK_MAP 登记、llm-streaming/event-producer-consumer 生成物重放 |

依赖边：无新增或删除。

调用流程：

```text
Models 页 → ctx.llm.discoverModels(ns, request)
  → registerModelDiscovery(settingsNs, ...)   [index.ts]
    → discoverModels(request, storedProfile, prepareHeaders)
        catalog 命中 → 直接返回（不触发钩子）
        wire 路径：
          Headers(stored.headers) + accept + 协议凭据
          → prepareHeaders({ provider, baseURL, api }, headers)
              即 ctx.waterfall('llm-pi-ai/discovery-headers', ...)
              LlmError → 保留 code 抛出；其他 → DISCOVERY_FAILED
          → attributionHeaders() 覆盖
          → fetch(url)
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| wire 探测 + 具名路由 | contributor 拿到 `{provider, baseURL, api}`、部署标头与凭据已就位、UA 未写；横幅 id 与 row id 一致 | `runs the discovery header hook after the route headers and credential and before attribution` |
| 无 provider 的新路由探测 | contributor 拿到 `{baseURL, api}`（无 provider） | 同上 |
| contributor 设 `user-agent` | 被 attribution 覆盖，端点收到 Harness UA | 同上（两例均断言） |
| contributor 抛 `LlmError('…','REQUEST_HEADERS')` | 保留 code，请求未发出 | `keeps a contributor LlmError code and stills the probe…` |
| contributor 抛普通 Error | `DISCOVERY_FAILED`，请求未发出 | 同上 |
| contributor 抛非 Error 值 | `DISCOVERY_FAILED` + 安全文案 | 同上（覆盖 `error instanceof Error` 另一支） |
| 推理 context 带 `purpose` | `PiAiRequestHeaderContext.purpose` 透传到监听器 | `composes request-local headers…`（补分支覆盖） |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `discovery.spec.ts` 新增 2 例 | 钩子顺序/上下文/frozen/UA 覆盖；编码错误保留与探测静默矩阵 |
| `request-headers.spec.ts` 补 `purpose` | 可选属性分支覆盖 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/llm/llm-pi-ai
  Test Files  23 passed (23)
  Tests  510 passed (510)

pnpm exec vitest run --coverage \
  --coverage.include='packages/llm/llm-pi-ai/src/**/*.ts' \
  packages/llm/llm-pi-ai
  Statements   : 100% ( 1103/1103 )
  Branches     : 100% ( 1001/1001 )
  Functions    : 100% ( 192/192 )
  Lines        : 100% ( 964/964 )

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped
  （含 cordis-catalog 与 doc-graphs 生成物一致性）
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent verified the gap exists exactly where the proposal described (discoverModels assembles its own Headers with no contributor hook), confirmed the parallel ordering already enforced by the inference path, and three-way checked no prior fix exists upstream or in the fork; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent mirrored the inference hook's contract verbatim (same listener signature, same call position, same LlmError-vs-fold policy), chose a minimal context shape ({provider, baseURL, api}) matching the proposal's naming, and kept the catalog path untouched so the hook fires only when a wire request is actually built; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent added the hook-order/context/UA-override spec and the coded-error/no-send matrix, confirmed 100% per-file coverage, and cross-checked the new event lands in regenerated cordis-catalog and doc-graph artifacts; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the context type, the hook wiring, the tests, the README revisions, the catalog registration, and re-recorded the translation pairs and generated docs. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
