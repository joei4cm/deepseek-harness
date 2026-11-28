## Motivation

上游 Discussion #14501 报告：Profile 中一个普通安装目录在同一进程内替换为 `link:` 包时，pnpm 安装成功但应用激活失败，错误为 `ENOENT: no such file or directory, lstat '<profile>/vendor'`。Node 的持久化 realpath 缓存保留了旧目录的 realpath 前缀，导致新 link 包内相对 vendor 链接被解析到 profile 根目录下不存在的路径。

Refs #14501

## Changes

**Interface changes**:

None。没有新增、删除或修改对外 API、配置、事件或持久化格式；HMR 继续沿用 Node 内部 resolver 接口。

**Behavior changes**:

- HMR 使某个 package manifest 失效时，如果 Node 提供 `purgeRealpathCacheForPrefix`，会清理该 package 目录下的 native realpath cache 条目；Node 24 不提供该接口时保持原有清理行为。
- 这让安装目录被替换为 package link 后，后续 resolver 能从新 link target 解析嵌套相对依赖，避免沿用旧目录拼接出的不存在路径。
- package manifest 读取、CommonJS path cache 清理和 ESM resolve cache 清理的既有行为不变。
- HMR README 的双语实现说明补充了 native realpath cache 清理行为，并在「已知限制」中记录 Node 24 的差距：该清理依赖 Node 26 才提供的 `purgeRealpathCacheForPrefix`，Node 24 的两个私有 realpath 缓存（`internal/modules/helpers` 与 `internal/modules/esm/resolve` 各一个）没有导出清理接口，已安装目录被 package link 替换后，嵌套依赖在 Node 24 上仍可能通过被替换的旧目录解析。

**Module responsibilities and dependencies**:

None。没有新增或删除包，也没有新增或删除工作区包之间的运行时依赖。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| Node 26 runtime 调用 HMR manifest invalidation | 只清理 package manifest、CommonJS path cache 和 ESM resolve cache，native realpath cache 保留旧目录前缀 | 调用 Node 提供的 `purgeRealpathCacheForPrefix(package directory)`，旧目录下的 realpath 条目被清理 | `package-manifest.spec.ts` 的 `purges Node realpath entries below an invalidated package`；该用例安装一个记录用的替身，因此在 Node 24 上同样执行并断言调用契约 |
| Node 24 runtime（CI 使用的 Node 版本） | 不存在 `purgeRealpathCacheForPrefix`，保持原有失效流程 | 检测到接口不存在时直接返回，不影响其他 cache 清理 | 同一用例在 Node 24 上以记录替身覆盖调用路径，新代码在 CI 的 Node 版本上保持 100% 覆盖率 |
| 实际 Plugin Manager 场景：安装目录 → remove → `link:` 包 | pnpm 成功，但新插件 import 因 `ENOENT lstat <profile>/vendor` 失败 | 新插件成功导入 nested vendor marker，Plugin Manager 报告 `application: applied` | Discussion #14501 的隔离 `cold` / `hot` / `swap` repro，修复后以 built CLI 和真实 profile composition 验证 |

**Test entries**（本地运行，基于 upstream `master` `841f76d3c5`）:

- Node 26.12.1：`PATH=/home/michael/.nvm/versions/node/v26.12.1/bin:$PATH pnpm exec vitest run packages/boot/hmr --maxWorkers=2`：10 个测试文件、241 个测试通过；`pnpm exec vitest run packages/boot/hmr/tests/package-manifest.spec.ts --maxWorkers=2 --coverage --coverage.include='packages/boot/hmr/src/package-manifest.ts'`：40 个测试通过，`package-manifest.ts` 的 statements/branches/functions/lines 均为 100%（146/146、95/95、25/25、118/118）。
- Node 24.22.3（CI 使用的版本）：同样的两条命令，241 个测试通过，`package-manifest.ts` 覆盖率同样为 100%（146/146、95/95、25/25、118/118）。
- 负对照：把 `package-manifest.ts` 还原为 `origin/master` 后运行新用例，断言失败（记录到的清理前缀为空数组）；恢复修复后通过。
- 实际 repro：`REPRO_CHECKOUT=/home/michael/codes/deepseek-harness /home/michael/.nvm/versions/node/v26.12.1/bin/node /home/michael/codes/tmp-logs/repro-14501.mjs swap`：修复前 exit 1，pnpm 成功但第三次操作为 `application: failed`、`ENOENT lstat <profile>/vendor`；修复后 exit 0，三次 `application: applied`，`marker: nested-vendor-loaded`。
- 其他验证：`pnpm exec oxlint packages/boot/hmr/src/package-manifest.ts packages/boot/hmr/tests/package-manifest.spec.ts` 通过；`git diff --check` 通过；`pnpm run typecheck` 5 个 gate 通过；`pnpm run build:check` 2 个 gate 通过；`pnpm run test:docs` 21 个 gate 通过；README translation pairing 已重新记录。

<details><summary>Proof</summary>

```text
# 修复前：Node 26.12.1，discussion repro swap
pnpm install exitCode: 0
application: applied
application: applied
application: failed
ENOENT: no such file or directory, lstat '<temporary-home>/profiles/repro/vendor'
repro exitCode: 1

# 修复后：同一 repro
application: applied
application: applied
application: applied
marker: nested-vendor-loaded
repro exitCode: 0

# Node 26.12.1 HMR coverage
Test Files  10 passed (10)
Tests       241 passed (241)
Statements  100% (146/146)
Branches    100% (95/95)
Functions   100% (25/25)
Lines       100% (118/118)

# Node 24.22.3（CI 版本）HMR coverage
Test Files  10 passed (10)
Tests       241 passed (241)
Statements  100% (146/146)
Branches    100% (95/95)
Functions   100% (25/25)
Lines       100% (118/118)

# 负对照：还原 origin/master 的 package-manifest.ts
expect(purged).toEqual([f.dir])
-   "/tmp/dsh-hmr-manifest-XUYxRY/packages/pkg",
- ]
+ []
Tests       1 failed | 39 skipped (40)
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 独立复现并确认旧安装目录的 realpath 前缀在目录替换为 link 后仍被 Node resolver 使用 |
| design 方案设计 | auto 模型自主 | 95% | Agent 在现有 HMR manifest invalidation 路径调用 Node 26 暴露的 native realpath cache purge helper，并保留 Node 24 的兼容分支 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 使用 Discussion 的隔离 repro 做 cold/hot/swap 验证，并补充 Node 26/24 回归测试与负对照 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 完成 HMR source、测试和 README 双语更新；独立评审指出新语句在 CI 的 Node 版本上不覆盖，Agent 据此重写测试并补充 Node 24 差距的文档 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
