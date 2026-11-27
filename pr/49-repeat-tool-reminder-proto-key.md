## Motivation

模型对同一工具的连发调用被重复检测 guard 以「(工具名, 规范化参数)」为键跟踪，但规范化用属性赋值构建排序对象：`JSON.parse` 把 `__proto__` 产出自有数据属性，而普通赋值会把同名键送进原型 setter——该字段被静默丢弃，凡仅在此键上有差别的不同调用共享同一条链键，三条互不相同的调用即触发「你在重复完全相同的调用」提醒（默认阈值 3），属于模型可见的误报。仓内自查发现的缺陷，无对应上游 Discussion。

## Changes

**Interface changes**: None。

**Behavior changes**:

- `sortJsonValue` 改用 `Object.fromEntries`（`CreateDataPropertyOrThrow`，写自有数据属性）构建排序记录：解析出参数中的自有 `__proto__` 键现在与其他键一样参与规范化与同一性判定，不再经原型 setter 静默消失，也不会再把仅在该键上有差别的调用合并成一条重复链。
- 其余行为不变：键排序顺序、`JSON.stringify` 序列化、链键构造、提醒文案与阈值升级全部保持既有断言兼容（该键只是从「被丢弃」变为「参与判定」）。
- README 双语的「Exact-match canonicalization」设计承诺补入「自有 `__proto__` 键按数据属性写入、参与同一性判定」——该承诺（深度键排序 + `JSON.stringify` 是完整同一性）因本修复而重新为真。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**:

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 三条调用：自有 `__proto__` 键值 `{x:1}`、无该键、`{x:2}` | 规范化全部坍缩为 `'{}'`，第 3 条触发「重复调用」提醒 | 三条规范化互不相同，不触发提醒 | 新增 `repeat-tool-reminder.spec.ts` 用例 |
| 三条调用全部携带相同自有 `__proto__` 键 | 规范化相同，仍触发提醒（坍缩成 `'{}'`） | 不变（规范化相同，仍触发） | 同一轮新增用例 |
| 详细提醒引用的规范化参数 | `arguments: {}`（字段丢失） | `arguments: {"__proto__":{"x":1}}` | 同一用例的文案断言 |
| 属性顺序不同、深层结构相同的调用 | 判定为重复 | 不变 | 既有「canonicalization ignores property order, deeply」用例 |
| 其余链语义（重置、排除透明、按 agent 键控、拒绝调用计数） | 不变 | 不变 | 既有用例 |

负控：把 `src/index.ts` 还原为 `origin/master` 后，新增两条用例失败（第一条得到 1 条误报提醒；第二条详细文案缺少 `{"__proto__"`）；打补丁后全部通过。

**Test entries**:

- 本机 `pnpm exec vitest run packages/guard/repeat-tool-reminder/tests/ --maxWorkers=2`：1 文件 / 24 用例全部通过（参数经真实 agent loop 与 mock adapter 的 wire 序列化往返，`JSON.parse` 在 `dsh-tools` 批处理中执行）。
- 本机同命令加 `--coverage --coverage.include='packages/guard/repeat-tool-reminder/src/index.ts'`：该文件语句 / 分支 / 函数 / 行覆盖率 100%。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run typecheck`：5 项门禁通过。
- 本机 `pnpm run build`：10 项门禁通过。
- 本机 `pnpm run test:docs`：21 项通过。
- 本机 `pnpm run doc-sync`：41 项通过，`tool catalog` 与 `package paths` 两项失败为上游 master 既有问题（`scripts/gen-tool-catalog.ts` 与 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/` 与 master 字节一致，本 PR 未触及）。
- 本机 `pnpm run verify-translation-pairing --write packages/guard/repeat-tool-reminder/README.md`：配对已重新记录。
- 未验证：真实模型轮次（mock adapter 已覆盖同一 wire 往返与 guard 判定路径）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 在仓内缺陷扫描中定位赋值式规范化与 `JSON.parse` 自有 `__proto__` 键的冲突，经 Node 执行复现字段丢弃与链键坍缩。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「`Object.fromEntries` 写自有数据属性」，保持排序、序列化与链语义不变。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 补「不同 `__proto__` 值不误报」与「相同 `__proto__` 值仍计链且文案引用该键」两条用例并跑负控、覆盖率与全部门禁。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写补丁与双语 README 更新。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
