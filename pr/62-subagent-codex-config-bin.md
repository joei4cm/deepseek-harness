## Motivation

`subagent-codex` 把官方 `@openai/codex` 精确锁定在 `0.153.4`，并在模块加载期通过 `createRequire(...).resolve('@openai/codex/package.json')` 定位包内 wrapper；协议兼容性由开发证据锁定，升级必须重新生成上游 schema 证据并重跑全部验证。较新的 Codex 模型因此无法在协议验证完成前使用：#14447 报告了这一阻塞，#9949 与 #11820 中多位用户以 profile 级 pnpm `overrides` 强制降/换版本作为变通，并明确希望支持可配置的可执行文件路径（"+1 on supporting a configurable binaryPath (config / env / fallback to bundled) instead of hard-pinning at module load time"）。

Refs deepseek-ai/deepseek-harness#14447（另见 #9949、#11820 的变通讨论）。上游不接受外部 PR，本分支位于 fork；也未在 Discussion 下发布回复（等待作者授权）。

## Changes

**Interface changes**

- `subagent-codex` Config 新增可选字段 `codexBin?: string`（`z.string().min(1)`，缺省不设置即沿用随包 wrapper）。设置时子进程以 `<codexBin> app-server --stdio` 直接启动该可执行文件；未设置时行为与现状逐字节一致（Node + 包内 wrapper + 固定参数）。
- `run.ts` 导出的 `codexAppServerArgv(codexBin?)` 增加可选参数；`CodexRunSpec` 新增可选 `codexBin`。两者都是包内导出，消费面为本包与测试。

**Behavior changes**

- `apply()` 在加载期校验 `codexBin`，自包含错误立即暴露：必须绝对路径、不得是 `.cmd`/`.bat` 批处理 shim（Windows 无 shell 时无法 spawn）、必须指向已存在且有执行权限的普通文件（`statSync` + `accessSync(X_OK)`）。错误消息携带配置的原路径。
- `#14447` 报告者提议的 `<codexBin> app-server --stdio` 形态被原样采纳：可执行文件直接作为 argv[0]，不再经 Host Node 间接启动，npm 全局安装的原生二进制即可使用。
- 其余行为不变：0.153.4 精确锁定不动，不提供环境变量或 PATH 查找，随包 wrapper 仍是缺省；无自动宿主 CLI 回退。
- README（英/中）同步：Config 表新增 `codexBin` 行、Run flow 与 Failure and recovery 的命令描述、Known Limitations 中证据范围的说明（`codexBin` 可执行文件不在 0.153.4 证据覆盖内，但提供方仍校验握手/线程/轮次响应并在未知服务端请求上失败）。`docs/config-catalog.md(.zh.md)` 由生成器更新。

**Module responsibilities and dependencies**

None。未新增或删除 workspace 运行时依赖，未移动包职责。

## Testing

**Test design**

行为矩阵（场景 × 改动前 × 改动后 × 覆盖测试）：

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 未配置 `codexBin` | spawn `[Node, 包内 wrapper, app-server, --stdio]` | 相同（回归保障） | 既有契约测试 `codexAppServerArgv()` 断言未改；全部既有用例通过 |
| 配置合法 `codexBin` | 字段不存在，无此能力 | spawn `[codexBin, app-server, --stdio]`，真实 app-server 走完整委派 | 新单测（scripted fake child）+ 新真实产品用例（真实 app-server + Responses fixture） |
| `codexBin` 非绝对路径 / `.cmd`/`.bat` shim / 不存在 / 目录 / 无执行位 | 字段不存在 | `apply()` 加载期 reject，错误含原路径 | 新单测 `rejects a configured Codex executable that cannot be launched at load`（执行位用例 POSIX 断言，Windows 跳过） |
| Config schema | `codexBin` 未知 | 可选非空字符串，空串拒绝 | 扩展 `accepts an optional non-empty model...` schema 用例 |

**Test entries**（均本地运行；CI 另跑矩阵）：

- `pnpm exec vitest run packages/subagent/subagent-codex/tests/ --maxWorkers=2 --coverage --coverage.include='packages/subagent/subagent-codex/src/**/*.ts'` — 75 passed；语句/分支/函数/行 100%（432/432、272/272、83/83、399/399）。
- `pnpm exec vitest run .../real-product.spec.ts -t 'configured Codex executable'` — 通过：真实 app-server 全链路返回 fixture 哨兵答案，`spawnSpecs[0].argv === [codexBin, 'app-server', '--stdio']`，子树 quiescent。
- 一次性手工验证：同一真实产品用例临时指向随仓安装的原生 `codex` 二进制（`@openai/codex-linux-x64` vendor 载荷），真实协议全链路通过后还原测试文件（未提交该临时改动）。
- 负对照：`git checkout origin/master -- src/index.ts src/run.ts` 后运行两套 spec，5 个新/改用例如期失败，恢复后全绿。
- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test:docs`、`pnpm run doc-sync` — 全部通过（doc-sync 首次因 config-catalog 过期失败，运行 `pnpm run gen-config-catalog` 后 43/43 通过，产物已入提交）。

<details><summary>Proof</summary>

```
Test Files  3 passed (3)
     Tests  75 passed (75)
Statements : 100% ( 432/432 )
Branches   : 100% ( 272/272 )
Functions  : 100% ( 83/83 )
Lines      : 100% ( 399/399 )
```

负对照（master 源码 + 新测试）：`Tests  5 failed | 62 passed (67)` —— 失败的正是 5 个新/改用例。

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 从 #14447/#9949/#11820 自行定位根因（模块加载期锁定 wrapper）与范围；用户仅设定目标与仓库纪律 |
| design 方案设计 | auto 模型自主 | 90% | Agent 决定字段形态、加载期校验与拒绝条件；采纳报告者在 #14447 提出的 `<codexBin> app-server --stdio` 形态 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 自行设计矩阵、真实产品用例与负对照并核对结果 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 写全部代码、测试与双语文档改动 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
