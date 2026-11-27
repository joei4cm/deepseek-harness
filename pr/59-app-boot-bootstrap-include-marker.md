## Motivation

桌面版停用/启用插件、安装/卸载 bundle 时稳定失败并报 `dsh: profile reload requires the root Include entry`，改动已写入 profile 文件却必须重启才生效（Discussion #14446）。

根因在 `dsh-app-boot` 的根 Include 记录方式：它被写进一个模块级 `WeakMap`，键是启动时传入的根 Context，只有**加载了本包的那一份实例**写入。宿主进程里若同时存在第二份 `@deepseek-ai/dsh-app-boot`（例如 profile 里的插件经 `internal.import(specifier, bareModuleBaseUrl)` 解析到另一份模块基址，于是同一文件有了两个 URL 形态），另一份实例的 `WeakMap` 里从来没有这条记录，热重载入口（`dsh-hmr`、`dsh-config-editor`）拿到的正是那一份实例，于是每次都抛出这条断言错误。

报告方在独立进程里用同一份 profile 与同样的启动契约复现时 `application=applied`，并给出两条对照：干净进程里 `recompose` 逻辑本身成立；出问题的是运行中的那个宿主进程。这与「两份模块实例」的解释一致，也与报告方建议的排查方向 2 一致。

Refs #14446

## Changes

**Interface changes**: None.

**Behavior changes**:

- 根 Include 的查找不再只依赖模块级 `WeakMap`：`mountRootInclude()` 在挂载根 Include 时，把该 Entry 额外标记到 **loader 服务对象**上，使用全局共享的 symbol（`Symbol.for('@deepseek-ai/dsh-app-boot/bootstrapIncludes')`）。两份模块实例共享同一个 loader 服务，因此都能读到同一份标记。
- `recompose()` 读取根 Include 的顺序为：先查本实例的 `WeakMap`（同实例调用者的快路径不变），查不到时读 loader 上的标记。两者都查不到时，仍然抛出原来的 `${binName}: profile reload requires the root Include entry`。
- 实例身份判断改为结构判断，不再依赖 `instanceof`：
  - 「当前 resolution 是否可重算」由 `computeLatestResolution` 方法是否存在决定，而不是 `instanceof ProfileRuntimeResolution`；
  - 「发布是否需要重启」由 `ResolutionRestartRequired` 类或错误的 `name` 决定，而不是仅 `instanceof ResolutionRestartRequired`。
- 公开函数、错误文案、重载语义、预检与判定流程均不变：`recomposeProfile()` / `reconcileProfilePatches()` 的签名、返回值（`warnings`、`restartReason: 'package-moved'`）、`app-boot/config-reload` 事件与启动审计的判定都不受影响。

**Module responsibilities and dependencies**: None.

**Direction decisions**（对应 Discussion #14446 的三条建议）：

1. **修查找，而不是降级**：报告方建议「把抛错改成可诊断的降级：带上 `ctx.fiber.name`、根 fiber id、是否存在 `id === 'include'` 的 entry；或直接返回 `restart-required`」。本分支选择修复查找本身——根 Include 确实存在（它是这次启动挂上去的），只是第二份实例看不到它。降级为 `restart-required` 会把一次可热应用的改动变成一次重启，与报告方的「期望行为：热重载即时生效」不符，因此不作为本分支的形状。
2. **跨实例的共享点选在 loader 服务上**：loader 服务是两份实例都能通过 `ctx.get('loader')` 读到的同一个对象，而 `WeakMap` 是模块私有状态。标记写在服务对象上，不引入新的全局状态容器，也不改动 `dsh-hmr` / `dsh-config-editor` 的调用方式。
3. **`instanceof` 一并放宽**：根 Include 找到之后，重算与重启判定原本仍有两处 `instanceof`；第二份实例里的 `ProfileRuntimeResolution` 与 `ResolutionRestartRequired` 是另一份类，`instanceof` 必然失败，所以这两处同样按方法形状与错误名判断。

**Message shape**: 无消息变化。`profile reload requires the root Include entry` 仍然在确实没有根 Include 时抛出，文本逐字不变。

## Testing

**Test design**（行为矩阵）：

| 场景 | 变更前 | 变更后 | 覆盖用例 |
|---|---|---|---|
| 同实例调用者查根 Include | 命中 `WeakMap` | 命中 `WeakMap`（快路径不变） | 既有用例 |
| 另一份模块实例查根 Include | `WeakMap` 未命中 → 抛断言错误 | 读到 loader 上的标记，继续重载 | 新增用例（loader 标记） |
| resolution 来自另一份实例（结构相同、非同一类） | `instanceof` 失败 → 跳过重算 | 按方法形状判定 → 重算并发布 | 新增用例（结构化 resolution） |
| 发布被另一份实例的 `ResolutionRestartRequired` 拒绝 | `instanceof` 失败 → 抛出内部错误 | 按错误名判定 → 返回 `restartReason: 'package-moved'` | 新增用例（错误名） |
| 发布被同名但非 `ResolutionRestartRequired` 的错误拒绝 | 抛出 | 仍然抛出（不吞错） | 新增用例（非重启错误） |
| 发布被非 Error 的值拒绝 | 抛出 | 仍然抛出原值 | 新增用例（非 Error 值） |
| 完全没有根 Include | 抛断言错误 | 抛同一断言错误 | 既有用例（未改） |

**Test entries**：

- 本地 `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run packages/boot/app-boot/tests --maxWorkers=2`：22 个文件、5689 个测试全部通过。
- 覆盖率（`--coverage --coverage.include='packages/boot/app-boot/src/index.ts'`，并合入 `packages/boot/hmr/tests`、`packages/boot/plugin-manager/tests`、`packages/boot/config-editor`）：改动文件语句 473/473、分支 294/294、函数 102/102、行 393/393，均为 100%；49 个文件、6395 个测试全部通过。
- 跨包回归：`packages/boot/hmr/tests packages/boot/plugin-manager/tests packages/boot/config-editor`（27 个文件、706 个测试）全部通过——这三处正是热重载与配置写入的调用方。
- 反向对照：把 `packages/boot/app-boot/src/index.ts` 还原为 `origin/master` 后，恰好 2 个新用例失败（loader 标记用例、结构化 resolution 用例），其余 119 个用例通过；恢复修复后全部通过。
- 本地 `NODE_OPTIONS="--max-old-space-size=8192" pnpm run typecheck`：5 个门禁全部通过。
- 本地 `pnpm run lint`：通过。
- 本地 `pnpm run test:docs`：21 通过、0 失败。
- 本地 `pnpm run doc-sync`：41 通过、2 失败。2 个失败均为本仓库既有问题，与本次改动无关：工具目录缺少 `tool-working-directory`，以及 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/guide.md` 仍引用上游已删除的 `packages/experimental/ptc-runtime-python`。
- 推送钩子 typecheck 门禁：5 通过、0 失败。
- 端到端证据的限制：本仓库没有报告方所用的桌面版打包形态（asar + `bareModuleBaseUrl`），无法在本机复现「同一份文件被解析成两个模块实例」的现场。新的用例用 `vi.resetModules()` 后重新 `import('../src/index.ts')` 造出第二份实例来模拟该形态；报告方在真实桌面宿主进程中的对照结果仍是这条路径的端到端证据。
- 没有 CI 结果：上游不接受外部 PR，因此分支暂存在 fork。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复核上游 Discussion #14446 的定位线索与对照实验，确认根 Include 的模块级 `WeakMap` 在第二份模块实例下必然查不到，是失败的结构性原因。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择「在 loader 服务上留跨实例标记」而非报告方建议的降级为 `restart-required`，并把两处 `instanceof` 一并改为结构判断。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计 loader 标记、结构化 resolution、错误名、非重启错误与非 Error 值五类用例，跑包内覆盖率、跨包回归与反向对照。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 实现跨实例标记与结构判断，并把测试用的假上下文补成真实上下文的服务读取形状。 |
| review 评审处理 | n/a 暂不适用 | — | No review comments have been handled. |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
