## Motivation

模型以 `stop` 结束、只产出 reasoning 块（或纯空白 text）时，两个适配器的判空都用「内容块数量为零」：`dsh-llm-deepseek` 的 `message_stop` 分支与 `dsh-llm-pi-ai` 的 `mapStopReason`。单个 reasoning 块让 `blocks.size === 1`，`EMPTY_RESPONSE` 永远抛不出——界面上显示「已完成」但正文空白，goal 驱动把空转轮计成正常轮，内置重试一次都不跑。报告者在插件层以同一判据拦截了 23 次空轮、零误报，且用户全程无感（重发几秒后出字）。Refs #14334

## Changes

**Interface changes**: None（错误码、wire 类型、配置均不变；仅完成分类判据变化）。

**Behavior changes**:
- 终止 `stop` 的 `EMPTY_RESPONSE` 判据从「零内容块」改为「无非空白 text 块且无 tool-call/toolCall 块」：reasoning-only、纯空白 text-only 的完成现在归类为可重试的 `EMPTY_RESPONSE`，默认重试策略接手（与 2026-07 `empty-response-retry` 为零块完成建立的通道一致）；失败尝试的 reasoning 保留在 `assistant/attempt`、模型历史之外。
- 边界不变：`max_tokens` 截断的 reasoning-only 流照常完成（截断不是空回复）；携带 text 或工具调用的 `stop` 照常完成；`toolUse` 结束原因不经此分支。
- 这是 207aab9d8d（2026-07-24）刻意边界「any block counts as content」的有据修订：该提交针对零块完成，reasoning-only 的空转轮与其动机（驱动不再计空转、重试自愈）同类；判据采用报告者实测过的形态（非空白 text 才算可见回复）。

**Module responsibilities and dependencies**: None（改动只在 `dsh-llm-deepseek` 的 `translate.ts` 判空分支与 `dsh-llm-pi-ai` 的 `mapStopReason`、两包测试与 README；无包间依赖变化）。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| reasoning-only + `stop`（两适配器） | 完成为「已成功」的空回复 | `EMPTY_RESPONSE` 错误，默认策略重试 | `stream.spec.ts` 'classifies a reasoning-only stop…'；`convert.spec.ts` 'classifies a thinking-only stop…' |
| 纯空白 text + `stop`（两适配器） | 完成 | `EMPTY_RESPONSE` | `stream.spec.ts` / `convert.spec.ts` 'classifies a whitespace-only text stop…' |
| reasoning + text + `stop` | 完成 | 完成（不变） | `stream.spec.ts` 'keeps a stop with reasoning and text successful'；`convert.spec.ts` 'keeps a stop with thinking and visible text successful' |
| 仅工具调用 + `stop`（pi-ai） | 完成 | 完成（不变） | `convert.spec.ts` 'keeps a stop with only a tool call successful' |
| reasoning-only + `max_tokens` | 完成 | 完成（不变） | `stream.spec.ts` 'keeps a reasoning-only truncated stream successful' |
| 零内容块 + `stop` | `EMPTY_RESPONSE` | `EMPTY_RESPONSE`（不变） | 既有用例（两适配器）+ `empty-response-retry` 快照 |

负控：先提交新用例再跑，恰好 4 个新分类用例失败（观察到完成 `{kind:'stop'}`），全部边界用例通过；应用修复后全绿。

**Existing test behavior**: `convert.spec.ts` 的 'keeps a thinking-only stop successful (any block counts as content)' 断言的是 207aab9d8d 引入的旧边界；本 PR 将其替换为新的 `EMPTY_RESPONSE` 分类用例并如上说明。`loader-composition.spec.ts` 存在与本改动无关的既有 flake：6 次运行 3 次失败（其中一次在还原本 PR 源码后复现），每次失败用例不同（'boots with zero routes…' / 'continues natively after max-token…' / 'continues a legacy session…'），失败均为 mock 服务器 `500 script exhausted` / `SERVER` 竞争；该文件三份 fixture 皆以 text 收尾（`length` 或 `stop`），新判据对其结果中性。最终证据轮 6/6 通过。

**范围说明**：判据采用报告者建议的「非空白 text 或工具调用」；第 6 次重试仍空时按既有预算 fail loud。快照回放服务于 harness 层 chunk（位于 wire 解析之下），本改动对录制快照零影响——`empty-response-retry`（零块场景）与含 reasoning-only 历史的 `present-after-closing-reply` 场景分别验证通过。

**Test entries**:
- `pnpm exec vitest run packages/llm/llm-deepseek/tests packages/llm/llm-pi-ai/tests --maxWorkers=2` — 44 个文件、1168 个用例通过（本机）。
- `pnpm run test:snapshot snapshots/session/headless.snapshot.ts -t 'empty-response-retry'` — 2 个选中用例通过（本机）。
- `pnpm run build`（build:artifacts + build:check + run-gates）— 通过（本机）。
- `pnpm run typecheck` — 5 个 gate 通过（本机）。
- `pnpm run lint` — 通过（本机；仅存一处与本改动无关的既有 warning）。
- `pnpm run doc-sync` — 43 个 gate 全过（本机；`dsh-llm-deepseek` README 英/中错误码契约已更新并重录 pairing）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据报告核对两处判空站点与 `207aab9d8d` 的引入历史，确认判据缺口与重试通道未被触发。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 采纳报告者的「非空白 text 或工具调用」判据并同步到两适配器，判定 `max_tokens` 截断与工具调用边界不变。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计行为矩阵与负控、替换旧边界测试、排查并披露 `loader-composition` 既有 flake（含无改动复现轮）。 |
| implementation 技术实现 | auto 模型自主 | 100% | 两处判据、JSDoc、双语 README 与全部测试由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
