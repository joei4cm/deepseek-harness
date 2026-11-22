## Motivation

用户希望把「哪类任务用哪个模型」的规则写在插件里配置一次，之后照常派活，但原生 `subagent` / `subagent_fork` 在创建子级前不向插件询问选模建议，插件只能用自己的一套委派入口。

Refs #14095

## Changes

**Interface changes**

- `@deepseek-ai/dsh-subagent` 新增 waterfall 事件 `subagent/model-advice`，并导出其请求与建议类型 `SubagentModelAdviceRequest`、`SubagentModelAdvice`。
- `@deepseek-ai/dsh-tool-subagent` 新增配置项 `modelAdvice`（默认 `false`）。

**Behavior changes**

- 开启 `modelAdvice` 后，当工具调用、工具的 `agentOptions`、后端的 `agentRouteDefaults` 都没有指定路由时，委派工具在创建子级前派发 `subagent/model-advice`。请求携带委派 Agent、工具名、后端提供方、标签、任务文本、可选 preset 与调用信号。
- 顾问由外向内执行，第一个建议生效；返回 `undefined` 或调用 `next()` 把决定留给后续顾问；整条链都不作答时保持配置的默认路由。
- 建议不构成授权：工具用管辖显式子级模型选择的同一份 Host 设置校验它，未授权路由以 `MODEL_ROUTE_NOT_ALLOWED` 失败而不是静默回退；与默认委派路由相同的建议无需额外授权。通过校验后，建议路由与其他已解析路由一样经过实时适配器预检。
- `modelAdvice` 独立于 `modelSelection`：fork 工具可以在不向模型公开路由字段的前提下接受路由建议，其子级仍以对话前缀播种。
- 建议改变路由时，父级继承的推理强度被清除（与显式选择路由一致）；建议重复父级路由时保留该强度。
- 启用 `modelAdvice` 的实例上，`provider` 字段描述中「省略时使用的路由」改为「本次委派解析出的模型与推理强度」；未启用的实例措辞不变。
- 提供方不支持 `agentOptions` 时挂载失败，与 `modelSelection` 的既有校验并列。
- 未开启 `modelAdvice` 的部署（含全部随附 preset）不派发该链，行为与数字完全不变。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-subagent` | `ctx.subagents` 的 Service Definition：命名提供方注册表与管理式激活 | 变更：新增 `subagent/model-advice` 扩展点声明与两个事件负载类型 |
| `dsh-tool-subagent` | 面向模型的委派工具（Service Consumer） | 变更：新增 `modelAdvice` 配置，派发建议链、按 Host 设置授权并合并结果 |

依赖边：无新增或删除。`dsh-tool-subagent` 原本就已依赖 `dsh-subagent`，本 PR 只使用其公开导出。

调用流程：

```text
subagent tool call
  → tool-subagent: no route named by call / agentOptions / agentRouteDefaults
  → ctx.waterfall('subagent/model-advice', request, next)
  → advisor plugin returns { provider, model }
  → subagentModelSelection.allowedRoutes() → assertAdvisedModelRoute
  → llm.resolveCallConfig(route)
  → ctx.subagents.startActivation({ agentOptions })
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 无路由的普通派活 | 采用顾问建议，子级请求带建议路由 | `routes a delegation that names no route through the mounted advisors` |
| 工具配置指定路由 | 不询问顾问，沿用配置 | `keeps the configured tool route when no advisor answers` |
| 调用显式指定路由 | 不询问顾问，显式路由优先 | `does not consult advisors when the call names its own route` |
| 两个顾问 | 最外层的建议生效，内层不被调用 | `lets the outermost advisor decide and stops the chain there` |
| 外层顾问让出 | 由下一层作答 | `defers to the next advisor when an earlier one answers with none` |
| 建议路由不在 Host 设置中 | `MODEL_ROUTE_NOT_ALLOWED`，不创建子级 | `refuses an advised route the Host setting does not authorize` |
| Host 设置关闭 | 只接受父级路由，其他建议被拒绝 | `limits advice to the parent route while the Host setting is disabled` |
| 建议重复默认路由 | 即使设置未列出该路由也接受 | `accepts advice that reproduces the default route without an entry in the setting` |
| 建议重复父级路由 | 保留继承的推理强度 | `keeps the parent reasoning effort when advice repeats the parent route` |
| `subagent_fork` | 接受建议，仍继承对话前缀、schema 不变 | `advises a fork tool without changing its conversation inheritance` |
| 提供方不支持 `agentOptions` | 挂载失败 | `fails the mount when the provider cannot apply Agent options` |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `routes a delegation that names no route through the mounted advisors` | 建议链路生效，请求负载字段完整，路由改变时清除继承强度 |
| `keeps the configured tool route when no advisor answers` | 工具配置路由优先，且顾问不被调用 |
| `does not consult advisors when the call names its own route` | 调用显式路由优先 |
| `lets the outermost advisor decide and stops the chain there` | waterfall 由外向内、首个建议短路 |
| `defers to the next advisor when an earlier one answers with none` | `next()` 让出语义 |
| `refuses an advised route the Host setting does not authorize` | 授权复查与 `MODEL_ROUTE_NOT_ALLOWED` |
| `limits advice to the parent route while the Host setting is disabled` | 设置关闭时的父级路由限制 |
| `accepts advice that reproduces the default route without an entry in the setting` | 默认路由建议无需授权 |
| `keeps the parent reasoning effort when advice repeats the parent route` | 预检与子级选项合并对强度的处理一致 |
| `advises a fork tool without changing its conversation inheritance` | fork 场景与继承文案 |
| `fails the mount when the provider cannot apply Agent options` | 挂载期失败 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/subagent
  Test Files  48 passed (48)
  Tests  1051 passed (1051)

pnpm run typecheck
  run-gates: 5 passed, 0 failed, 0 skipped

pnpm run lint
  exit 0

pnpm run build
  run-gates: 10 passed, 0 failed, 0 skipped

pnpm run doc-sync
  run-gates: … （见下方结论）
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent read Discussion #14095 and scoped the extension point to the delegation tool; the author selected this topic from the Agent's list of candidate features. |
| design 方案设计 | auto 模型自主 | 90% | The Agent chose a waterfall event over a new service package, the `modelAdvice` opt-in, the first-suggestion-wins arbitration, and reusing the Host allowlist for authorization; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent set the case matrix and wrote all eleven tests; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the event declaration, the consumer, the config option, the tests, both README revisions, the Agent Note triplet, and regenerated the derived documentation. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
