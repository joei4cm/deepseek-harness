## Motivation

Discussion #14280 报告：`team_task_list` 在 `{"owner": "", "unowned": true}` 时报 `owner and unowned filters cannot be combined`，尽管空字符串是模型填写可选字符串参数的常见习惯。模型被拒后会换多种过滤组合重试，白白消耗步数。

在 master 上的核对结论（问题比报告再多一层）：

1. **报告的冲突**：互斥守卫在归一化之前——`args.owner !== undefined && args.unowned !== undefined` 直接拒绝，空字符串被当成「提供了一个 owner 过滤」。
2. **报告未提的静默面**：`{"owner": ""}` 单独传入时不报错，但会进入 `resolveName(caller, '')`。`resolveName` 对「不含 `/` 的单个 token」按 Session id 原样返回，于是空字符串被 branded 成一个空 Session id，过滤条件变成 `task.ownerId === ''`，**静默返回零任务**——比报错更难诊断。

工具 schema DSL 的 string 规格不支持 `minLength`，报告者建议的协议层约束在本仓库不可用；在做出决定的 `execute` 里归一化是唯一落点，也与「Enforce a decision in the operation that makes it」一致。

**范围说明**：`team_task_update`（reassign 动作）的 `owner` 参数走同一个 `resolveName`，空字符串会静默把任务挂到一个不存在的空 owner 上——这是写路径，语义与读路径不同（该参数的文档语义是「省略即 unassign」），归一化为「省略」会变成一次隐式 unassign。本 PR 只改报告所指的读路径，写路径的处置（拒绝还是归一化）留给维护者决定，见 Discussion 回复。

Refs #14280

## Changes

**Interface changes**

- 无公开 API 变化。`team_task_list` 的 `owner` 参数对空字符串/全空白值的接受行为变化；schema 文本不变。

**Behavior changes**

- `team_task_list`：在互斥守卫之前归一化 `owner`——`undefined`、空字符串或全空白一律视为「未提供该过滤」；非空值裁剪首尾空白后解析。
  - `{"owner": "", "unowned": true}` → 不再报错，按 `unowned: true` 过滤（报告的期望行为）；
  - `{"owner": ""}` 单独传入 → 不加 owner 过滤（此前静默返回零任务）；
  - `{"owner": " agent-1 "}` → 裁剪后按 `agent-1` 解析过滤；
  - `{"owner": "<真实名称>", "unowned": true}` → 仍然报 `owner and unowned filters cannot be combined`（互斥语义不变）。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-tool-agent-team` | Agent Teams 的任务板工具与策略提示 | 变更：`team_task_list` 的 owner 过滤归一化；README 文档化空值语义 |

依赖边：无新增或删除。

调用流程：

```text
team_task_list.execute(args)
  owner 归一化：undefined / '' / 全空白 → undefined；否则 trim()
  ownerName !== undefined && unowned !== undefined → ToolArgsError（不变）
  ownerName === undefined → 不加 owner 过滤
  ownerName !== undefined → resolveName → 按 ownerId 精确过滤（不变）
```

**Docs**

- `packages/team/tool-agent-team/README.md`(+`.zh`)：在过滤说明段落补「为空或全空白的 `owner` 视为未提供该筛选；真实名称前后的空白在解析前裁剪」。

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| `{"owner": "", "unowned": true}`（报告用例） | 不报错；只返回无 owner 的任务 | `treats an empty owner filter as omitted instead of conflicting with unowned` |
| `{"owner": ""}` 单独传入 | 不报错；不加 owner 过滤，两张任务都在 | 同上 |
| `{"owner": "   ", "unowned": true}` | 与空字符串同义，按 `unowned` 过滤 | 同上 |
| `{"owner": " <名称> "}`（首尾空白） | 裁剪后按该名称过滤 | 同上 |
| `{"owner": "<真实名称>", "unowned": true}` | 仍报 ToolArgsError（互斥不变） | 同上 + 既有 `distinguishes an agent named unowned from tasks without an owner` |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `tests/tool-team.spec.ts` 新增 1 例 | 空/空白 owner 的归一化矩阵 + 真实名称互斥不变 |

命令与结果（本地运行）：

```
pnpm exec vitest run --maxWorkers=2 packages/team/tool-agent-team
  Tests  46 passed (46)

pnpm exec vitest run --maxWorkers=2 --coverage \
  --coverage.include='packages/team/tool-agent-team/src/**/*.ts' \
  packages/team/tool-agent-team
  Statements   : 100% ( 60/60 )
  Branches     : 100% ( 62/62 )
  Functions    : 100% ( 18/18 )
  Lines        : 100% ( 54/54 )

pnpm exec oxlint packages/team/tool-agent-team
  exit 0

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped
```

红绿证据（先写失败测试）：新测试在未改源码时失败于报告的第一现场——`Error: invalid arguments: owner and unowned filters cannot be combined`；应用修复后 46/46 全绿。

快照影响：无。工具 schema 与描述文本不变（`docs/tool-catalog.md` 与 `snapshots/*/tool-schemas.expected.json` 无需更新）；没有录制会话包含空 owner 的调用（既有行为是报错），所以本修复不改变任何录制回放。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent reproduced the reported conflict on master and found a second, unreported symptom (an empty-string owner alone silently filters to zero tasks through `resolveName`'s Session-id fallback), confirmed the schema DSL has no `minLength` so normalization must happen in `execute`, and checked upstream master, the fork branches, and the staged descriptions for duplication; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent normalized the owner filter before the mutual-exclusion guard (empty or whitespace-only means omitted; surrounding whitespace on a real name is trimmed), kept the genuine conflict loud, and deliberately left the `team_task_update` reassign write path untouched because its documented "omit to unassign" semantics make the empty-string decision different; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent wrote the failing test first (red at the reported error), covered the empty, whitespace-only, trimmed-name, and still-conflicting cases, and confirmed 100% per-file coverage; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the normalization, the test, and the English and Chinese README revisions, and re-recorded the translation pair. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
