## Motivation

scoped REPL 通过扫描原始源码来拒绝包含保留前缀 `__$binding_` 的程序，但 acorn 会把标识符中的 unicode 转义规范化，`const __$binding_getters = 1` 能通过扫描并编译进生成的程序：该声明与生成的 `__$binding_getters` 参数同名，执行时以一个不带位置信息的 `ReferenceError: Cannot access '__$binding_getters' before initialization` 失败，既绕过了保留名诊断，也让模型无法定位原因。对运行时发现的缺陷，无对应上游 Discussion。

## Changes

**Interface changes**: None。

**Behavior changes**:

- 含有解码后出现 `__$binding_` 前缀的标识符的程序，现在与原始源码中出现该前缀的程序一样，在扫描阶段以同一种定位的语法错误（文件名、行号、插入符与 `Names starting with '__$binding_' are reserved`）被拒绝；非标识符位置（字符串、注释中的转义文本）不受影响，仍由原始扫描覆盖。
- 不含反斜杠的程序不注册解析回调，常见路径的行为和开销不变。
- `packages/ptc-runtime/ptc-runtime-node/README.md` 与 `README.zh.md` 的 scoped REPL 条目补入「解码后包含此前缀的标识符同样被拒绝」。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**:

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 程序用 `const __$binding_getters` 声明保留名 | 扫描通过，编译后的程序以无位置 `ReferenceError` 失败 | 扫描阶段以定位语法错误拒绝，插入符指向转义标识符起点 | 新增 `scoped-repl.spec.ts` 用例 |
| 程序用 `const a` 声明普通名 | 声明按解码后的名称登记 | 不变（不误伤合法转义标识符） | 同一用例断言 `declarations` 为 `{ a: 'const' }` |
| 保留名声明之前的语句 | `globalThis.ran = true` 可能已执行 | 拒绝发生在任何程序副作用之前 | 新增 `scoped-repl-mode.spec.ts` 进程级用例 |
| 原始源码含前缀（字符串/注释） | 扫描阶段拒绝 | 不变 | 既有 `it.each` 用例 |

负控：把 `src/evaluators/scoped-repl.ts` 还原为 `origin/master` 后，新增 scanner 用例失败（`scanProgram` 未抛出 `SyntaxError`），新增 mode 用例失败（错误是 `ReferenceError` 而非保留名诊断）；打补丁后全部通过。

**Test entries**:

- 本机 `pnpm exec vitest run packages/ptc-runtime/ptc-runtime-node/tests/scoped-repl.spec.ts packages/ptc-runtime/ptc-runtime-node/tests/scoped-repl-mode.spec.ts --maxWorkers=2`：2 文件 / 138 用例全部通过（mode 用例经真实运行时进程）。
- 本机同命令加 `--coverage --coverage.include='packages/ptc-runtime/ptc-runtime-node/src/evaluators/scoped-repl.ts'`：该文件语句 / 分支 / 函数 / 行覆盖率 100%。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run build`：10 项门禁全部通过。
- 本机 `pnpm run test:docs`：21 项通过。
- 本机 `pnpm run doc-sync`：41 项通过，`tool catalog` 与 `package paths` 两项失败为上游 master 既有问题（`scripts/gen-tool-catalog.ts` 与 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/` 与 master 字节一致）。
- 本机 `pnpm run verify-translation-pairing --write packages/ptc-runtime/ptc-runtime-node/README.md`：已重新记录。
- 未验证：宿主工具调用路径（`run_code` 端到端 + 真实模型轮次）未运行，进程级用例已覆盖同一评估器代码路径。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 在审计 scoped REPL 测试覆盖时复现转义标识符绕过，定位 acorn 规范化与原始扫描的差异。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「解析期 name token 回调记录首个解码后含前缀的标识符位置，解析后抛同一语法错误；无反斜杠的程序不注册回调」。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 补 scanner 与进程级用例、合法转义不误伤断言并跑负控与覆盖率。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写补丁与双语 README 更新。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
