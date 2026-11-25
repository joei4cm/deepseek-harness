## Motivation

`scrubbedParentEnv()` 的凭据清洗模式 `/KEY|PASSWORD|SECRET|TOKEN/i` 会命中 `GIT_CONFIG_KEY_n` 剥掉键名，却留下 `GIT_CONFIG_COUNT` 和 `GIT_CONFIG_VALUE_n`。Git 先读计数器：一个继承了「计数器但缺键」组的子进程在执行任何 `git` 命令时都报 `error: missing config key GIT_CONFIG_KEY_0` / `fatal: unable to parse command-line config`——shell 工具、被拉起的脚本、内部调用 git 的程序全部失败。上游 2026-09 的 Windows 自托管 lane 就因同一原因挂了 12 个用例（Agent Note `2026-09-27-plugin-manager-git-child-environment` 已记录根因与 deferred 的产品侧修复方案，本 PR 即实现之）。

Refs #14242

## Changes

**Interface changes**

无。`scrubbedParentEnv` 的签名与返回类型不变。

**Behavior changes**

- `scrubbedParentEnv()` 新增一组剔除：`GIT_CONFIG_COUNT`、`GIT_CONFIG_PARAMETERS`、`GIT_CONFIG_KEY_n`、`GIT_CONFIG_VALUE_n` 视作一个原子组整体移除——子进程要么看到完整的环境配置组，要么完全看不到，不再出现「计数器在、键被剥」的半组状态。
- 行为边界不变：调用方显式 `env` 仍在清洗之后合并，所以有意转发 `GIT_CONFIG_*` 值依然生效；`GIT_TERMINAL_PROMPT` 等不含凭据语义的普通 `GIT_*` 名字照常保留。
- 该组剔除与 `DSH_*` 一样按大小写不敏感匹配（Windows 环境名不区分大小写）。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-subprocess` | 子进程服务与共享环境清洗基线 | 变更：`scrubbedParentEnv` 增加 Git 命令行配置组剔除 |

依赖边：无新增或删除。所有经 `scrubbedParentEnv` 起步的消费者（subprocess-local spawn、SDK 子 agent、plugin-manager git 传输、MCP transport 等）自动获得该修复。

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 环境带完整 `GIT_CONFIG_COUNT/KEY_n/VALUE_n/PARAMETERS` 组 | 全部移除，不留半组 | `scrubbedParentEnv drops Git command-line config as one group, never orphaning the counter` |
| 普通 `GIT_*` 名字（`GIT_TERMINAL_PROMPT`） | 保留 | 同上 |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `scrubbedParentEnv drops Git command-line config as one group, never orphaning the counter` | 组内四个名字同时存在时全部移除；`GIT_TERMINAL_PROMPT` 证明剔除是按名字组而非 `GIT_*` 前缀 |
| `scrubbedParentEnv drops credential-shaped and DSH_ names…`（既有） | 原有行为不回归 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/subprocess/subprocess/tests
  Test Files  4 passed (4)
  Tests  17 passed (17)

pnpm exec vitest run --coverage \
  --coverage.include='packages/subprocess/subprocess/src/**/*.ts' \
  packages/subprocess/subprocess/tests
  Statements   : 100% ( 34/34 )
  Branches     : 100% ( 18/18 )
  Functions    : 100% ( 6/6 )
  Lines        : 100% ( 29/29 )

pnpm exec vitest run packages/subprocess
  Test Files  25 passed | 1 failed | 1 skipped
  Tests  466 passed | 1 failed | 14 skipped
  ※ spawn-runner.spec.ts「resolves Windows executables with target-cwd and PATH
    search semantics」在未修改的 master（dsh-v0.2.3-alpha.2）上同样失败，为预存问题，与
    本 PR 无关。

pnpm exec tsc -b tsconfig.host.json
  exit 0
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent verified the reported mechanism against `scrubbedParentEnv` and located the repo's own earlier analysis (Agent Note + deferred product fix); the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent adopted the deferred design already documented in the repo's Agent Note: remove the whole GIT_CONFIG group in the shared scrub so deliberate forwards still override; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent wrote the group-removal test covering all four names plus a surviving ordinary GIT_* name; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the group pattern, the test, both README revisions, and recorded the translation pair. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
