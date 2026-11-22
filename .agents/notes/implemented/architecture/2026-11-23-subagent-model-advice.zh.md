# Agent Note: Subagent model advice

Status: implemented

[English](2026-11-23-subagent-model-advice.md) | 中文

## Problem

Host 设置已经列出了委派可使用的子级 LLM 路由，工具公开路由字段时模型也能按次选择。但两者都无法表达「检查用这个模型、复杂工作用另一个」这类规则：允许列表只说明哪些路由可用，不说明什么任务该用哪条路由；而调用未指定路由时，子级沿用父级路由。想要这类规则的用户只能每次都提醒模型，或者让路由插件绕开原生 `subagent` 与 `subagent_fork` 工具，用自己的一套模型可见入口来做选择。

## Decision

`@deepseek-ai/dsh-subagent` 声明 `subagent/model-advice`：委派消费方在为路由尚未确定的子级创建之前派发该 waterfall。`@deepseek-ai/dsh-tool-subagent` 是随附的派发方。只有当它的 `modelAdvice` 选项开启，且工具调用、工具的 `agentOptions` 与后端的 `agentRouteDefaults` 都未指定路由时才查询该链；请求携带委派 Agent、工具名、后端提供方、标签、任务文本、可选 preset 与调用信号，因此插件无需自行读取 Session 就能按任务选模。

顾问由外向内执行，第一个建议生效：监听者返回 `{ provider, model }`，或调用 `next()` 把决定留给其余顾问。没有监听者、或监听者全部让出的链保持配置的默认路由不变。

建议从不构成授权。工具用管辖显式子级模型选择的同一份设置（`allowedRoutes()`）校验它，未授权的路由以 `MODEL_ROUTE_NOT_ALLOWED` 拒绝，然后对它执行与其他已解析路由相同的实时适配器预检。与默认委派路由相同的建议无需授权即可接受，因为普通委派本来就把子级运行在那里。因此顾问只能在用户已允许的路由中选择；路由插件挂载了却没有对应设置时会显式失败，而不是静默地什么都不改变。

`modelAdvice` 与 `modelSelection` 分离，后者才决定模型能否看到路由字段。fork 工具可以在 schema 不变、子级仍以对话前缀播种的前提下接受路由建议；路由一旦改变，仍会失去提供方对前缀的复用，这一点已由既有的 fork 限制说明。建议的路由发生改变时，父级继承的推理强度会被清除，因为子级选项合并把这条路由完全当作显式路由处理。

## Alternatives considered

### Why not extend `modelSelection`?

把 `modelSelection` 同时当作建议开关，会让插件路由与一项模型可见的 schema 变更绑在一起，而随附 fork 工具正是为了保留继承前缀的复用才关闭 `modelSelection`。建议需要在不公开路由字段的前提下到达 `subagent_fork`，因此它获得了自己的选项。

### Why not a service registry?

带 `register(advisor)` 的服务只会有一个消费方（`dsh-tool-subagent`）和一个内部调用者，这正是包规则要避免的形态；而且它需要新包来承载注册面，或在既有包上增加第二个插件入口。waterfall 用零新增服务、零组合变更和仓库既有的覆盖语义达到同样效果。

### Why not let advice bypass the allowlist, or apply it inside `startActivation`?

讨论要求由 DSH 决定建议的模型是否可用。在运行时应用建议，会让包括没有模型选择策略的调用方在内的所有调用都被插件改路由；在那里校验也会把 LLM 知识搬进传输接缝。把派发留在委派工具里，能让校验紧挨着它复用的授权。

### Why not have the model name the route every time?

这正是讨论报告的状态，对希望规则自动生效、不愿每次派活都改写习惯的用户来说并不可行。

## Consequences

- 路由规则住在插件里，对每次普通的 `subagent` 与 `subagent_fork` 调用生效，并始终受 Host 设置约束。
- 路由记录在子级自己的请求头中，日志本就能重建哪个模型运行过；因此没有新增 Session 事件。
- 建议未授权路由的路由插件现在会让委派以 `MODEL_ROUTE_NOT_ALLOWED` 失败，而不是被忽略，过期的规则会在下一次调用时暴露。
- `modelAdvice` 不增加任何模型可见 schema；只有启用它的实例上「省略字段时使用的路由」措辞会变化，否则「你当前的模型」会变成假话。
- 未启用 `modelAdvice` 的调用方（今天是其他所有委派入口）从不派发该链，行为与之前完全相同。

## Testing

`packages/subagent/tool-subagent/tests/model-advice.spec.ts` 覆盖：建议生效的路由、无建议时的默认值、显式选择优先、配置路由优先、由外向内仲裁、`next()` 让出、未授权建议的 `MODEL_ROUTE_NOT_ALLOWED`、Host 设置关闭时限定为父级路由、建议重复父级路由时保留推理强度、fork 工具保留继承与 schema，以及提供方不支持 `agentOptions` 时的挂载失败。
