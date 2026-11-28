## Motivation

上游 Discussion #14504 报告：IM 聊天中的 `/help`、`/status`、`/stop`、`/clear` 等斜杠指令全部失效并被当作普通文本交给模型。各适配器入站内容都经过 `@deepseek-ai/satori-element` 的 `normalize()`，行内文本会被包裹进 `<p>` 块，而 `parseCommand` 只检查 `<message>` 的直接子节点，遇到 `<p>` 直接返回 `undefined`。

Refs #14504

## Changes

**Interface changes**:

None。没有新增、删除或修改对外 API、配置、事件或持久化格式。

**Behavior changes**:

- `parseCommand` 在 `<message>` 首个子节点是 `<p>` 时穿透该段落块查找命令，同时保留对未包裹直出 `<message>` 的兼容。
- 首个 `<p>` 之后若存在其他块，以换行符拼接到 `rawInput`（与 `toText()` 的块分隔语义一致），确保像 `<p>/compact</p><p>keep this</p>` 这样的多段落透传指令传入 `dsh-commands` 时仍有命令名与参数之间的空白边界（`/compact\nkeep this`），不会拼成无效命令名 `/compactkeep this`。
- 首块不是 `<p>`（如 `<blockquote>`）或空消息仍解析为 `undefined`。

**Module responsibilities and dependencies**:

None。没有新增或删除包，没有新增或删除工作区包之间的运行时依赖，也没有转移包职责。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 经 `normalize()` 包裹的单段指令（`/help`、`/compact  keep this`、`@bot /stop`） | 返回 `undefined`，命令落入模型 | 正确解析 `name` 与保留前导空白的 `rawInput` | `packages/experimental/im/tests/intake.spec.ts` 的 `parses a slash command after the self-mentions` |
| 经 `normalize()` 包裹、且首段有 `@someone-else` | 返回 `undefined` | 仍返回 `undefined` | 同一用例 |
| 经 `normalize()` 包裹的多段指令（`<p>/status</p><p>trailing</p>`、`<p>/compact focus</p><p>line 2</p>`） | 返回 `undefined` | 以 `\n` 分隔后续块进入 `rawInput`（`\ntrailing`、` focus\nline 2`） | 同一用例 |
| 首个 `<p>` 后跟空 `<p>` | 返回 `undefined` | `rawInput` 保持 `""`（不附加多余换行） | 同一用例 |
| 非 `<p>` 首块（`<blockquote>`）或空消息 | 返回 `undefined` | 仍返回 `undefined` | 同一用例 |
| 端到端：`im-session-commands` 派发 `normalize()` 后的内置 `/help` 与多段透传 `/compact` | `command` 为 `undefined`，waterfall 返回 `ignored` | `session-commands` 接手处理，透传命令收到 `rawInput: "\nkeep this"` | `packages/experimental/im-session-commands/tests/commands.spec.ts` 的 `dispatches normalized paragraph-wrapped commands, including multi-paragraph passthrough input` |

**Test entries**（本地运行，基于 upstream `master` `841f76d3c5`）:

- `pnpm exec vitest run packages/experimental/im packages/experimental/im-session-commands --maxWorkers=2 --coverage --coverage.include='packages/experimental/im/src/intake.ts'`：16 个测试文件、437 个测试全部通过；`packages/experimental/im/src/intake.ts` 的 statements/branches/functions/lines 均为 100%（276/276、186/186、62/62、230/230）。
- 负对照：将 `parseCommand` 还原为 `origin/master` 的实现后运行两个测试，均失败——`intake.spec.ts` 对 `normalize(h.text('/help'))` 返回 `undefined`，`commands.spec.ts` 对 `normalize(h.text('/help'))` 返回 `{ kind: 'ignored' }`；恢复修复后通过。
- 其他验证：`pnpm exec oxlint packages/experimental/im/src/intake.ts packages/experimental/im/tests/intake.spec.ts packages/experimental/im-session-commands/tests/commands.spec.ts` 通过；`git diff --check` 通过；`pnpm run typecheck` 5 个 gate 通过。

<details><summary>Proof</summary>

```text
# 负对照（将 parseCommand 还原为 origin/master 实现）
FAIL  packages/experimental/im/tests/intake.spec.ts >
      admission and drafts > parses a slash command after the self-mentions
- Expected: { "name": "help", "rawInput": "" }
+ Received: undefined

FAIL  packages/experimental/im-session-commands/tests/commands.spec.ts >
      passthrough > dispatches normalized paragraph-wrapped commands, including multi-paragraph passthrough input
- Expected: { "by": "session-commands", "kind": "handled" }
+ Received: { "kind": "ignored" }

Test Files  2 failed (2)
Tests       2 failed | 78 skipped (80)

# 修复后：两包测试与 intake.ts 覆盖率
Test Files  16 passed (16)
Tests       437 passed (437)
Statements   : 100% ( 276/276 )
Branches     : 100% ( 186/186 )
Functions    : 100% ( 62/62 )
Lines        : 100% ( 230/230 )
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 核实适配器均经 `normalize()` 包裹 `<p>` 块并定位 `parseCommand` 仅检查直接子节点 |
| design 方案设计 | auto 模型自主 | 95% | Agent 在报告者方案基础上将后续段落以 `\n` 拼接进 `rawInput`，避免多段透传指令丢失命令名边界 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 补充 `normalize()` 单元测试与 `im-session-commands` 端到端用例，并用负对照验证回归检出 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 完成 `intake.ts` 修改与两包测试补充，确保 `intake.ts` 保持 100% 覆盖率 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
