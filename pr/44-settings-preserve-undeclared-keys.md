## Motivation

设置表单在一次保存中会静默删除配置里 `Config` schema 未声明的键：当插件把整个 `Config`（或一个嵌套对象）标记为 `.volatile()` 时，`SettingsForms.write` 的 `strip` 在 volatile 路径上直接返回 `{}`，把为更新版本插件保留的键、迁移期用户遗留的键和手写注释一起清空。Refs #14400

## Changes

**Interface changes**: None。

**Behavior changes**:

- `SettingsForms.write`（`packages/settings/settings/src/index.ts`）的 `strip` 不再按「路径为 volatile 就返回 `{}`」处理，改为与 `projectForm` 互逆：普通对象值只剔除 schema `dict` 声明的 volatile 字段，未声明的键原样保留；嵌套对象递归处理且剔空后删除容器；`!!js` 表达式节点（`{__jsExpr}`）与普通对象区分，volatile 对象路径上的表达式在写入新值时被整体替换而不是当作字段合并。
- 影响只覆盖整个对象 schema 或其嵌套对象被 `.volatile()` 时，raw 配置中 schema 未声明的键；`!!js` 表达式在 volatile 对象路径上的行为同样符合预期。
- `packages/settings/settings/README.md` 与 `README.zh.md` 增加一句：表单写入只替换已声明的 volatile 字段，对象 schema 未声明的键原样保留。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**:

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| volatile 根对象带未声明键，`update`/`mutate`/`replace` | `strip` 返回 `{}` 删除 `extra` / `nestedExtra` | 未声明键保留 | 新增 `configuration.spec.ts` 第一条用例 |
| 嵌套 volatile 对象带未声明键，`update` | `strip` 删除整个 `nested` | `extra` 保留在 `nested` 内 | 新增第二条用例前半 |
| 嵌套 volatile 对象剔空（无未声明键）的 `replace` | 保留 `nested: {}` | `nested` 容器被删除，其余 raw 保留 | 新增第二条用例中段 |
| volatile 对象路径上是 `!!js` 表达式（`{__jsExpr}`），`mutate` | `__jsExpr` 被当作普通字段保留 | 表达式被整体替换 | 新增第二条用例后半 |
| `z.dict` / 非对象 volatile 根的 `unset` | 仅字符串键路径命中，未覆盖行为 | 删除对应键、保留其他键 | 新增第三条用例前半 |
| `dict` 为空的 volatile 根对象，`update` | `strip` 返回 `{}` 删除 `extra` | `extra` 保留 | 新增第三条用例后半 |

负控：在未打补丁的 master 上，3 条新用例全部失败（`strip` 返回 `{}`，删除未声明键）；打补丁后 6 文件 58 用例全部通过，`packages/settings/settings/src/**/*.ts` 覆盖率 100%。

**Test entries**:

- 本机 `pnpm exec vitest run packages/settings/settings/tests/ packages/api/settings-controller/tests/settings-controller.host.spec.ts --coverage --coverage.include='packages/settings/settings/src/**/*.ts'`：6 文件 / 58 用例，覆盖率 100%（语句 / 分支 / 函数 / 行）。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run build`：10 项通过。
- 本机 `pnpm run test:docs`：21 项通过。
- 本机 `pnpm run doc-sync`：41 项通过，`tool catalog` 与 `package paths` 两项失败为上游 master 既有问题（`scripts/gen-tool-catalog.ts` 与 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/` 与 master 字节一致）。
- 本机 `pnpm run verify-translation-pairing --write packages/settings/settings/README.md`：已重新记录。
- 未验证（产品决定）：#14400 的主体（desktop `sanitizeProfile` 把整个 `cordis.patch.yml` 移走并重建空数组）是否换实现 / 加恢复提示 / 改按钮文案，维持本 PR 不处理。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 定位到 #14400 主体为产品决策、可修复的是 `SettingsForms.write` 的 `strip` 丢键行为。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「`strip` 与 `projectForm` 互逆 + `!!js` 表达式整体替换 + 剔空删除容器」。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 补负控（3 条新用例在未打补丁时失败）并跑齐 100% 覆盖率门禁。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写补丁、双语 README 与回归用例。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
