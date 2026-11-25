## Motivation

排查 #14262 时发现的姊妹缺陷（与 `fix/session-fork-workspace-grouping` 互为独立变更）。

侧栏会话行菜单的 Fork 动作（`packages/client/ui-workspace/src/client/index.ts`）对拒绝的处理只识别 `session/migration-required`，其余全部静默吞掉。而 Host 的 fork 是「先创建子会话、再挂载工作区」：挂载失败（`session/workspace-attach-failed`）时子会话已经存在，客户端 manager 会把它 reconciled 进列表（cwd 继承自源会话，见 `manager.fork` 对 attach 失败的显式处理）。于是用户看到的是「功能正常、cwd 是父工作区、却落在未分组」的子会话，且**没有任何提示**——这正是 #14262 报告的外在表现。同一手势两条路径表现不一致：快捷键分叉（`shortcuts.ts`）会通过通知通道报告 unavailable/failed，菜单分叉完全静默。

修复：菜单 fork 的拒绝与快捷键分叉走同一通知通道——`session/fork-unavailable` 显示 unavailable 提示，其余失败显示 failed 提示并保留诊断日志（`console.warn`）；`session/migration-required` 保持原有的「打开源会话完成迁移」Toast。裸 `RemoteError`（未包装）按其结构标记 `isDSHRemoteError` 读取 code，未包装的迁移拒绝同样得到打开源会话的提示。

Refs #14262

## Changes

**Interface changes**

- 无公开 API 变化。`ForkSessionInjected.forkSession` 的失败上报行为变化。

**Behavior changes**

- 侧栏菜单 Fork 拒绝时（此前全部静默）：
  - `session/migration-required` → `forkRequiresOpen` Toast（不变；未包装的裸 `RemoteError` 现在也识别）；
  - `session/fork-unavailable` → `shortcutForkFailed`（reason `unavailable`）通知，不记日志；
  - 其余任何失败（含 `session/workspace-attach-failed`）→ `shortcutForkFailed`（reason `failed`）通知 + `console.warn` 诊断日志。
- 与快捷键分叉的通知面完全一致；通知类型与文案无新增（复用既有 `shortcut.forkFailed` / `shortcut.noCompletedTurn` 本地化键）。
- 聊天内 `forkAt`（`ui-chat`）的静默是刻意设计（失败保持源视图不变），本 PR 不动。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-client-ui-workspace` | 侧栏工作区/会话浏览与动作 | 变更：菜单 fork 注入的失败上报矩阵 |

依赖边：无新增或删除（裸 `RemoteError` 按结构标记判定，不引入运行时导入）。

调用流程：

```text
菜单 Fork → uiWorkspace.forkSession → sessions.fork → remote session.fork
  拒绝回到 index.ts 的 catch：
    包装错误（SessionForkError，按 name 判定）→ rpcError.code
    裸 RemoteError（isDSHRemoteError 结构标记）→ code
    code = session/migration-required → notify forkRequiresOpen（return）
    code = session/fork-unavailable   → notify shortcutForkFailed('unavailable')
    其他                              → notify shortcutForkFailed('failed') + console.warn
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 包装错误：`session/fork-unavailable` | `shortcutForkFailed`（unavailable），无日志 | `reports a menu fork rejection as a unavailable toast instead of staying silent` |
| 包装错误：`session/workspace-attach-failed`（#14262 场景） | `shortcutForkFailed`（failed）+ `console.warn` | `reports a menu fork rejection as a failed toast instead of staying silent` |
| 普通 Error（无 RPC code） | `shortcutForkFailed`（failed）+ 日志 | 重写后的 `reports a fork rejection through the toast surface (ordinary)` |
| 包装错误：fork-unavailable（矩阵） | `shortcutForkFailed`（unavailable），无日志 | 同上 `(other-remote)` |
| 裸 `RemoteError`：migration-required | `forkRequiresOpen`（结构标记识别），无日志 | 同上 `(unwrapped-migration)` |
| 包装错误：migration-required | `forkRequiresOpen`（不变） | 既有 `offers to open a source only after the Host refuses migration…` |

行为变更说明：既有测试 `keeps a fork failure silent after rejection` 钉的是「其余拒绝静默」这一过时行为（测试描述行为而非正确性），本 PR 将其重写为上报矩阵。

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `reports a menu fork rejection as a $reason toast instead of staying silent`（it.each 两例） | 包装错误的 unavailable / failed（含 attach-failed 场景）上报与日志差异 |
| `reports a fork rejection through the toast surface ($kind)`（it.each 三例，重写） | 普通 Error、包装 fork-unavailable、裸 migration 的结构标记识别与通知路由 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/client/ui-workspace
  Tests  570 passed (570)

pnpm exec vitest run --coverage \
  --coverage.include='packages/client/ui-workspace/src/**/*.ts' \
  --coverage.include='packages/client/ui-workspace/src/**/*.tsx' \
  packages/client/ui-workspace
  Statements   : 100% ( 1013/1013 )
  Branches     : 100% ( 750/750 )
  Functions    : 100% ( 319/319 )
  Lines        : 100% ( 861/861 )

pnpm run test:gui
  exit 0（全部客户端与宿主 GUI 套件）

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped

DSH_SNAPSHOT=replay pnpm run test:web
  未通过；失败原因是本机环境，不是本 PR 的改动：
    - workspace (@deepseek-ai/dsh-workspace): Error: Unknown system error -122: Unknown system error -122, write
      （packages/storage/storage-json/lib/index.js 的 writeAtomic 落盘失败）
    - authentication-token (@deepseek-ai/dsh-host-authentication-token): FileLockError: atomic-write: timed out waiting for
      the writer lock at /tmp/dsh-web-e2e-ws-jGk3yn/.dsh-home/.credentials.yaml.lock
    - remote-connection (@deepseek-ai/dsh-client-remote-connection): RemoteAuthenticationError: Remote browser-session
      credentials could not be loaded; check the credential provider before enabling Remote login.
  workspaceRegistry 因此不可用，session-controller、workspace-controller、ui-deliverables 连锁 pending，web e2e 脚手架
  报 "warning: 6 entries did not activate"，其余 60 余个 web e2e 文件随之以 0 test 结束。
  有断言失败的 19 个文件为 turn-tail-actions、open-in-app-menus、deepseek-messages-settings、models-settings、
  voice-download、composer-focus、context-meter、session-inspector、markdown-wide-table、session-replay-reload、
  menu-material、anchored-panels、focus-rings、shortcuts-workspace、minimal-preset、server-restart、
  agent-preset-selection、smoke-real、inspector-panels；失败栈中没有指向本 PR 改动
  （packages/client/ui-workspace 的 fork 拒绝上报）的断言。该 lane 的最终结论交由 PR CI 给出。
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | While investigating Discussion #14262, the Agent traced the exact reported symptom (functional but ungrouped fork child, no visible error) to the sidebar menu fork swallowing every rejection except migration-required, with the manager reconciling the child into the list after a failed workspace attachment; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent reused the shortcut fork's existing notice channel and locale keys (no new copy), read bare `RemoteError`s through their documented structural marker to avoid a forbidden runtime import, and deliberately left the chat fork action's documented silence untouched; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent rewrote the obsolete silent-behavior test into the reporting matrix (tests describe behavior), added the wrapped-error reporting cases including the attach-failure scenario, and confirmed 100% per-file coverage; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the rejection handling, the tests, and the English and Chinese README revisions, and re-recorded the translation pairs. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
