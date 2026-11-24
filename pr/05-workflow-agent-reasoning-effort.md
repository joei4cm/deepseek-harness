## Motivation

`dsh-workflow-ptc` 的 `agent()` 钩子把 `reasoningEffort` 列在支持名单之外，传了就抛 `UNSUPPORTED_OPTION`。但下游 `dsh-subagent` 的 `startActivation` 早就通过 `agentOptions.reasoningEffort` 接受并转发推理强度——链路只在 workflow 这一环断开。编排类插件按角色分配思考强度是通用需求（task 用重分析、verify/triage 用轻校验），调用方若在 workflow 层遵守用户配置的强度，每次调用都会失败；有的调用方把 `UNSUPPORTED_OPTION` 当作可用性失败静默回退到默认强度，用户配置的 thinking effort 无声失效。

Refs #14243

## Changes

**Interface changes**

- `agent()` 的脚本侧选项集新增 `reasoningEffort`（字符串）。`ChildStartRequest`（guest→host 的 PTC 请求类型）新增同名字段。

**Behavior changes**

- 脚本写 `agent(prompt, { reasoningEffort: 'high' })` 不再报错；值与其他标量选项一样要求是字符串，随 `startChild` 透传到 host。
- host 把 `reasoningEffort` 并入 child 的 `agentOptions`（brand 为 `ReasoningEffortId`），与 `provider`、`model` 同层合并；三者至少有一个给出时才构造 `agentOptions`。
- 兼容性检查照旧：`effort`/`isolation`/`agentType` 仍按 deferred 拒绝，未知选项仍报「not recognized」，报错文案里的支持名单同步更新为 `label, phase, schema, provider, model, reasoningEffort`。
- 强度值本身不由 workflow 层校验——它与 provider/model 一样是 adapter 自有词汇，由 subagent/agentOptions 路径在 start 时按既有规则拒绝非法值。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-workflow-ptc` | 沙箱 Node 进程里跑脚本编排的 workflow 引擎 | 变更：`agent()` 选项白名单加 `reasoningEffort`；guest 校验并经 PTC 绑定转发；host 并入 `agentOptions` |

依赖边：无新增或删除（`dsh-llm` 的 `ReasoningEffortId` 已是类型层引用）。

调用流程：

```text
agent('verify', { reasoningEffort: 'low' })
  → guest readAgentOptions: whitelist + string check
  → ChildStartRequest { prompt, reasoningEffort }
  → PTC binding: host.childRequest validates text
  → startActivation { ..., agentOptions: { reasoningEffort } }
  → subagent provider merges over parent/defaults
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 仅 `reasoningEffort` | `agentOptions` 只带 effort 字段 | `agent({reasoningEffort}) forwards effort-only agentOptions through PTC bindings` |
| effort 与路由字段组合 | `agentOptions` 同时带 provider/model/effort | `agent({reasoningEffort}) combines with the other route fields` |
| effort 与 schema 组合 | request 同时带 outputSchema 与 effort-only `agentOptions` | `runs the six-global script API and forwards structured child options and progress`（guest）+ `agent({schema, model})`（PTC 全链路） |
| 非字符串 effort | `INVALID_ARGUMENT`（与其他标量一致） | `rejects a non-string reasoningEffort like every other scalar option`（guest）+ `startChild` 参数矩阵 `reasoningEffort: 4`（host 绑定） |
| host 绑定透传 | `startActivation` 收到含 effort 的 `agentOptions` | `collects child results without parent delivery…` 断言更新 |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `agent({reasoningEffort}) forwards effort-only agentOptions through PTC bindings` | effort 独立成行进入 `agentOptions` |
| `agent({reasoningEffort}) combines with the other route fields` | effort 与 provider/model 合并 |
| `rejects a non-string reasoningEffort like every other scalar option` | 类型校验与 INVALID_ARGUMENT |
| `agent({schema, model}) forwards outputSchema and agentOptions…` | 增加第二次 schema+effort 调用，覆盖 host `startChild` 的 effort 透传分支 |
| `runs the six-global script API…`（guest.spec） | guest 内直接断言两次 `startChild` 请求分别携带 effort 与 effort+schema |
| `collects child results…`（host.spec） | `startActivation` 调用参数含 `agentOptions: { model, reasoningEffort }` |
| `startChild` 参数矩阵 | `reasoningEffort: 4` → `reasoningEffort must be a string` |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/workflow/workflow-ptc
  Test Files  8 passed (8)
  Tests  145 passed (145)

pnpm exec vitest run --coverage \
  --coverage.include='packages/workflow/workflow-ptc/src/**/*.ts' \
  packages/workflow/workflow-ptc
  Statements   : 100% ( 509/509 )
  Branches     : 100% ( 341/341 )
  Functions    : 100% ( 97/97 )
  Lines        : 100% ( 442/442 )

pnpm exec tsc -b tsconfig.host.json
  exit 0

pnpm run verify-workflow-guest
  exit 0（guest-source.ts 随本 PR 重新生成）
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent verified the Discussion's claim against the source (whitelist in runtime.ts, downstream support in subagent) and selected it from its own candidate list; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent chose to forward effort as a plain string through the existing startChild binding and brand it host-side into agentOptions, matching the provider/model path; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent extended three spec files (guest direct, host binding, PTC end-to-end) and traced two v8 coverage gaps to reach 100% branches; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the option handling, regenerated the guest bundle, updated the tests and both README revisions, and recorded the translation pair. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
