## Motivation

上游 Discussion #13356 报告：`terminal-bash` 的沙箱模式 fence 把每个 Agent 的状态放在模块级 `WeakMap` 里，并在创建 fence 时捕获注入的 `sandboxPolicy` 与 `terminals` 服务实例。当策略服务被替换（配置驱动的 fiber 重启）时，fence 仍与已撤销那一代的默认值比较：与当前默认值相同的变更被拒绝，而真正收窄模式的变更在 PTY 仍受旧模式约束时反而放行。

Refs #13356

## Changes

**Interface changes**:

None。没有新增、删除或修改对外 API、配置、事件或持久化格式。

**Behavior changes**:

- fence 在 `sandbox/mode` 事件派发时通过 owner 的作用域读取 `sandboxPolicy` 与 `terminals` 服务，因此当时生效的那一代决定结果：策略服务被替换后，fence 比较的是当前默认值，而不是已撤销一代的默认值。
- fence 的 per-owner 记录改为 backend 实例持有的 `WeakSet<Agent>`，不再使用模块级 `WeakMap`；同一 backend 实例对同一 owner 只注册一次 fence。
- 没有策略服务时不存在可比对的有效模式，没有终端注册表时没有需要保护的活动；这两种情况下 fence 不拒绝写入，也不调用已经释放的服务。
- terminal-bash 的 README 双语补充「fence 读取变更派发时生效的策略代次」这一行为说明。

**Module responsibilities and dependencies**:

None。没有新增或删除包，没有新增或删除工作区包之间的运行时依赖，也没有转移包职责。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| fence 创建后策略服务被替换，模式变更与当前默认值相同 | 与已撤销一代的默认值比较，合法变更被拒绝 | 与当时生效的默认值比较，不拒绝 | `packages/terminal/terminal-bash/tests/index.spec.ts` 的 `fences a mode change against the policy generation that is live at the change` |
| fence 创建后策略服务被替换，模式变更与当前默认值不同 | 与已撤销一代的默认值比较 | 拒绝，错误信息给出当时生效的模式 | 同一用例的后半段断言 |
| 策略服务缺失（重载窗口） | 调用已释放的服务 | 不拒绝：没有有效模式可比较 | 同一用例的边界断言 |
| 终端注册表缺失 | 调用已释放的服务 | 不拒绝：没有需要保护的活动 | 同一用例的边界断言 |
| 同一 backend 为同一 owner 再次 spawn | 模块级 WeakMap 跨实例去重 | 同一实例只注册一个 fence 监听器 | 同一用例的 `internal/listener` 计数断言 |
| 提供方重载后 fence 仍归属 owner | 有效 | 不变 | 既有用例 `keeps the owner-lifetime sandbox fence after the local provider unloads` |

**Test entries**（本地运行，基于 upstream `master` `841f76d3c5`）:

- `pnpm exec vitest run packages/terminal/terminal-bash --maxWorkers=2`：6 个测试文件，118 个测试通过、3 个跳过。
- `pnpm exec vitest run packages/terminal/terminal-bash --maxWorkers=2 --coverage --coverage.include='packages/terminal/terminal-bash/src/index.ts'`：`packages/terminal/terminal-bash/src/index.ts` 的 statements/branches/functions/lines 均为 100%（101/101、52/52、17/17、86/86）。
- 负对照：把 `packages/terminal/terminal-bash/src/index.ts` 还原为 `origin/master` 后运行新用例，断言失败（fence 仍以 `read-only` 为当前模式，拒绝了与生效默认值相同的 `workspace-write` 变更）；恢复修复后通过。
- 其他验证：`pnpm exec oxlint packages/terminal/terminal-bash/src/index.ts packages/terminal/terminal-bash/tests/index.spec.ts` 通过；`pnpm run typecheck` 5 个 gate 通过；`pnpm run build:check` 2 个 gate 通过；`pnpm run test:docs` 21 个 gate 通过；README translation pairing 已重新记录。

<details><summary>Proof</summary>

```text
# 修复前（还原 origin/master 的 src/index.ts）
FAIL  packages/terminal/terminal-bash/tests/index.spec.ts >
      fences a mode change against the policy generation that is live at the change
AssertionError: expected [Function] to not throw an error but 'Error: cannot change sandbox mode fro…' was thrown
+ Received:
"Error: cannot change sandbox mode from \"read-only\" to \"workspace-write\" while persistent terminal
 sessions are open or being created; wait for creation to settle and close them first"
Tests       1 failed | 20 skipped (21)

# 修复后：terminal-bash 包测试
Test Files  6 passed (6)
Tests       118 passed | 3 skipped (121)

# 修复后：terminal-bash/src/index.ts 覆盖率
Statements   : 100% ( 101/101 )
Branches     : 100% ( 52/52 )
Functions    : 100% ( 17/17 )
Lines        : 100% ( 86/86 )
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 从上游 Discussion #13356 的报告出发，确认 fence 捕获服务实例导致策略服务替换后与已撤销一代比较 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择在事件派发时读取生效服务，并把 per-owner 记录移到 backend 实例，同时保留 owner 生命周期的 fence 归属 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 编写替换策略服务后的双向断言与两个服务缺失的边界断言，并用还原源码的负对照证明用例能捕获回归 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 完成 terminal-bash 源码、测试与 README 双语更新，并按仓库规则调整类型标注与 lint |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
