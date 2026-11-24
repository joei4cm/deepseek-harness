## Motivation

#14262 报告：在工作区 A 里分叉会话，子会话落在侧栏「未分组」，其会话内工作目录仍是 A、功能正常；直接新建的会话能正确归入 A。

在 master 上的排查结论：

1. fork 的 Host 挂载主路径是正确的——本 PR 新增的 REAL 组合测试（真实 `WorkspaceRegistry` + `SessionStore` + 内存 storage，经 shipped remote 走完整 fork）钉住了「工作区成员的 fork 子会话进入该工作区成员表」这一行为；此前没有任何测试把 fork 与真实 registry 组合起来。
2. 真正的缺陷在 `forkWorkspace` 的查找依据：它通过**候选投影**（`Workspace.sessionIds` 的过滤视图）查找源会话的工作区。候选过滤是面向展示的——启动索引时对源会话 cwd 做 `realpath`/`stat`，非 ENOENT 的失败（Windows 上杀毒软件或同步目录造成的瞬时 EPERM 等）会把**仍是持久成员**的源会话从视图中隐藏；而侧栏的增量帧携带的是记录的原始成员表，所以用户看到的父会话仍归组正常。此时 fork 静默跳过挂载：无错误、子会话功能正常、cwd 继承 A——正是报告的症状。

修复思路：fork 子会话继承源 cwd，因此属主工作区可以由该目录解析——候选视图未命中时，经 `workspaceRegistry.resolveByPath(source.cwd)` 解析属主；挂载仍由 `attachSession` 重新校验子会话 cwd，语义不变。不可解析的目录容忍为「无属主」，成员保留（missing 目录保留成员资格）与 subagent lineage 仍是裁决者。

范围说明：排查同时发现侧栏菜单 fork 的失败静默（`session/workspace-attach-failed` 等拒绝没有任何提示），作为独立变更拆分在姊妹 PR（`fix/workspace-menu-fork-failure-notice`）。

Refs #14262

## Changes

**Interface changes**

- 无公开 API 变化。`forkWorkspace` 的内部解析顺序扩展。

**Behavior changes**

- `forkWorkspace` 解析顺序：候选成员命中 → **新增：按源 cwd 解析属主工作区**（目录不可解析时容忍为无属主）→ 普通会话无属主（行为不变：不分组、无错误）→ subagent lineage 回退（不变）。
- 属主命中后照旧走 `attachSession`：子会话 cwd 与工作区路径不一致时仍响亮失败（`session/workspace-attach-failed`），不会错误归组。
- 缺失目录的持久成员路径不变（候选保留 → 挂载失败仍响亮）。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-session-controller` | 会话命令面（fork/create/prompt 等） | 变更：`forkWorkspace` 新增按 cwd 属主的回退解析 |
| `dsh-workspace` | 工作区实体与成员账户 | 不变：复用公开 `resolveByPath` |

依赖边：无新增或删除。

调用流程：

```text
session.fork(source)
  → forkWorkspace(source.header)
      候选投影查找源会话            → 命中：沿用（不变）
      未命中且 source.cwd 有定义
        → resolveByPath(source.cwd)
            属主命中 → 返回该工作区（新增回退）
            目录不可解析 → 容忍为无属主（成员保留/lineage 裁决）
      普通会话 → undefined（不分组，无错误，不变）
      subagent → traceSession 找最近的属主祖先（不变）
  → agents.create（meta.cwd 继承源 cwd）
  → workspace.attachSession(childId)   // 重新校验子 cwd == 工作区路径
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 工作区成员 fork（真实 registry 组合） | 子会话进入工作区成员表 | `attaches the fork child to the workspace that owns the source`（新 REAL 组合 spec） |
| 候选视图隐藏持久成员（瞬时索引失败） | 按源 cwd 属主挂载，attach 被调用 | `attaches through the workspace owning the source cwd when the candidate view hides the source` |
| 源 cwd 无属主工作区 | fork 成功，子会话不分组、无错误 | `leaves the fork child ungrouped when the source cwd owns no workspace`（it.each） |
| 源 cwd 不可解析 | 容忍为无属主，fork 成功不报错 | `leaves the fork child ungrouped when the source cwd does not resolve`（it.each） |
| 无 cwd 的普通 fork | 不分组、无错误 | `leaves a cwdless ordinary fork child ungrouped` |
| 候选命中 / subagent lineage | 行为不变 | 既有 `omits absent cwd…` / `attaches a subagent fork to its nearest workspace-owning ancestor` 等 |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `session-fork-workspace-real.host.spec.ts`（新文件） | 真实 `WorkspaceRegistry` + `SessionStore` + 内存 storage domain，经 `createSessionTestRemote` 完整 fork：父会话挂载 → fork → 子会话出现在成员表 |
| `attaches through the workspace owning the source cwd when the candidate view hides the source` | 回退解析命中：`resolveByPath` 返回属主，`attachSession(childId)` 被调用 |
| `leaves the fork child ungrouped when the source cwd owns no workspace / does not resolve` | 回退未命中与解析失败的容忍路径 |
| `leaves a cwdless ordinary fork child ungrouped` | `source.cwd` 未定义时跳过回退 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/api/session-controller/tests/commands-create-fork.host.spec.ts \
  packages/api/session-controller/tests/session-fork.host.spec.ts \
  packages/api/session-controller/tests/session-fork-workspace-real.host.spec.ts
  Test Files  3 passed (3)
  Tests  44 passed (44)

pnpm exec vitest run packages/api/session-controller packages/workspace
  Tests  1249 passed (1249)

pnpm exec vitest run --coverage \
  --coverage.include='packages/api/session-controller/src/**/*.ts' \
  packages/api/session-controller packages/experimental/session-inspector packages/client/ui-chat
  Statements   : 100% ( 1803/1803 )
  Branches     : 100% ( 1132/1132 )
  Functions    : 100% ( 370/370 )
  Lines        : 100% ( 1567/1567 )
  ※ client/contract/events.ts 的 settleAssistant 覆盖来自 session-inspector / ui-chat
    消费方套件，与本 PR 无关；带上消费方后逐文件 100%。

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent reproduced the reported flow on master with a real-composition test (which passed, proving the primary path correct), then traced the remaining asymmetry to `forkWorkspace` consulting the candidate-filtered projection instead of durable membership, and matched the symptom chain (silent skip, functional child, inherited cwd) to the Discussion; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent designed the cwd-owner fallback through the public `resolveByPath` (tolerant of unresolvable directories, preserving member retention for missing directories and the subagent lineage arbiter), keeping attach-time cwd revalidation as the enforcement point; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent added the real-composition spec (filling the identified fork × real-registry gap) and the fallback matrix tests, and confirmed 100% per-file coverage with the consumer suites; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the fallback, the tests, and the English and Chinese README revisions, and re-recorded the translation pairs. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
