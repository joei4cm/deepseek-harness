## Motivation

一次思考阶段的流式回答被取消后，harness 按既有设计把已交付前缀落成 `interrupted: true` 的 `assistant/message`——当取消发生在任何 text 或 tool-call 块出现之前时，这条消息的内容只有单个 `reasoning` 块。下一轮请求把它序列化成只含未签名 `thinking` 块的 assistant 消息，Anthropic-Messages 兼容端点整条拒绝（HTTP 400 "The content field is a required field."）。由于消息是持久的，此后每一轮都在 1 秒内失败、不产出任何 token，会话永久卡死（重试、重开、重启均无法自愈）。Refs #14340

## Changes

**Interface changes**: None（wire 类型、配置、导出均不变；仅请求构造行为变化）。

**Behavior changes**:
- Messages 请求序列化：不含任何 `text` 或 `tool_use` 块的 assistant 消息整条省略——无论其 `thinking` 块有无签名。被取消的 reasoning-only 前缀、以及以 `stop` 结束却只产出 reasoning 的完成轮次（`finish_reason=stop` 的空正文形态），都不再出现在模型请求中；相邻的 user 消息因此正常合并。
- 持久日志与界面不变：durable `assistant/message` 原样保留，transcript 照旧显示该前缀；省略只发生在请求视图。签名回放元数据不受影响——携带 text/tool-use 的消息仍按既有规则保留或省略签名。
- 携带 text 或 tool-use 的消息行为不变（含退化回放：签名丢弃后 thinking 与正文照常发送）。

**Module responsibilities and dependencies**: None（改动只在 `dsh-llm-deepseek` 的序列化分支、README 与规格内；无包间依赖变化）。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 中断的 reasoning-only assistant 消息夹在两轮 user 之间 | 请求携带 `[{type:"thinking"}]`，provider 400 | 消息省略，相邻 user 合并 | `serialize.spec.ts` 新用例 'omits an assistant message with only thinking blocks and merges the adjacent user turns' |
| 已签名的 reasoning-only assistant 消息 | 请求携带签名 thinking-only 轮次 | 消息省略，durable 内容原样 | 新用例 'omits a signed reasoning-only assistant message while keeping the durable content' |
| thinking + text 的 assistant 消息 | 保留 | 保留（不变） | 新用例 'keeps an assistant message that pairs thinking with text or tool use' |
| thinking + tool-use 的 assistant 消息 | 保留 | 保留（不变） | 既有用例 'omits saved empty assistant text without changing tool ids or thinking signatures' |
| 退化回放元数据（11 个变体） | thinking 无签名照发 | 行为不变；fixture 补 text 块以保持消息在请求内，各变体的失败分支（对象解析、计数、类型、签名校验）逐一保持 | 'degrades unusable replay state with a diagnostic' 变体扩充 |
| 外来历史（无回放元数据）签名省略 | thinking 无签名照发 | 行为不变；fixture 补 text 块 | 'preserves own signed thinking…' 内子断言扩充 |

负控：先提交三个新用例再跑（修复前），恰好两个 omission 用例失败（观察到请求含 `[{type:"thinking"}]`），boundary 用例通过；应用修复后全绿。

**Existing test behavior**: 退化回放与外来历史两组用例原以 reasoning-only 消息为 fixture 断言「无签名 thinking 照发」；新契约下这类消息整条省略，fixture 各补一个 text 块与对应回放条目，使消息保留、每个变体原本命中的校验分支不变。行为变化本身由 PR 的 Behavior changes 说明。

**范围说明**：省略同时覆盖已签名形态（完成即空轮次），与中断形态适用同一契约「Messages 轮次必须有 text 或 tool-use」；报告建议 2（前缀改落 `assistant/attempt`）未实施——会丢失界面可见的前缀。#14340 报告只涉 Messages 适配器；其他协议适配器未改动。

**Test entries**:
- `pnpm exec vitest run packages/llm/llm-deepseek/tests --maxWorkers=2` — 33 个文件、714 个用例通过（本机）。
- `pnpm run test:web:built apps/web/tests/present-after-closing-reply.e2e.ts` — 唯一含 reasoning-only 消息的录制快照场景通过（本机；回放按调用序号匹配录制响应，请求形状变化不影响回放命中）。
- `pnpm run build`（build:artifacts + build:check + run-gates）— 通过（本机，最终树）。
- `pnpm run typecheck` — 5 个 gate 通过（本机）。
- `pnpm run lint` — 通过（本机；仅存一处与本改动无关的既有 warning）。
- `pnpm run doc-sync` — 43 个 gate 全过（本机；README 英/中双语契约已更新并重录 pairing）。
- 推送时的 pre-push typecheck — 通过（本机）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据报告在当前代码树逐条核对（`agent.ts:493` 持久化设计、`serialize.ts` 空内容跳过、wire 形态），确认根因链成立。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 在报告两个方案中采纳首选（序列化省略），判定省略覆盖已签名形态以统一契约，并放弃改动持久化设计。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计行为矩阵与负控（先测试后修复），调整退化回放 fixture 并逐变体核对校验分支不变。 |
| implementation 技术实现 | auto 模型自主 | 100% | 序列化守卫、JSDoc、双语 README 与全部测试由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
