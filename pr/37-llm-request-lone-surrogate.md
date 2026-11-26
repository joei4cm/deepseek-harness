## Motivation

工具输出若以半个星形字符结尾，消息请求体里就会带上未配对的 UTF-16 代理项；`JSON.stringify` 按规范把它转义成 `\uXXXX`，而 Messages API 的 JSON 解析器拒绝整个请求体，于是该会话之后每一次请求都以同样的方式失败，会话就此无法再使用。Refs #14391

## Changes

**Interface changes**: `dsh-util-values` 新增两个导出——`toWellFormedText(text)` 把一个字符串里的每个孤立 UTF-16 代理项替换为 U+FFFD，`toWellFormedValue(value)` 把同一条规则应用到 value 里的每个字符串并返回保持结构的副本；既有导出的签名不变。

**Behavior changes**:

- DeepSeek 适配器在生成 HTTP 载荷前，先把请求体（含插件贡献的扩展字段）里的每个字符串变为合法文本：孤立代理项替换为 U+FFFD。
- pi-ai 适配器在把上下文交给 SDK 之前做同样处理；处理发生在前缀摘要计算之前，摘要覆盖的正是发出去的文本。
- 不含孤立代理项的请求逐字节不变：`toWellFormedValue` 对没有变化的 value 返回原对象，`toWellFormedText` 对已经合法的字符串返回同一个字符串。
- Session 日志保留原始文本。模型看到的请求是日志文本在「孤立代理项替换为 U+FFFD」这一定义下的投影，因此已经写入坏文本的会话在下一次请求时自行恢复，不需要重写 zstd 日志。
- 替换只作用于字符串：数字、布尔值与 null 原样保留，class 实例、buffer 等对象原样带过。

**Module responsibilities and dependencies**:

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-util-values` | `toWellFormedText`、`toWellFormedValue`：把值中的孤立 UTF-16 代理项换成 U+FFFD | 新增这两个导出 |
| `dsh-llm-deepseek` | DeepSeek Messages 适配器：把请求历史与工具结果转成 Messages 请求体并发送 | 发送前把请求体（含扩展字段）里的字符串变为合法文本 |
| `dsh-llm-pi-ai` | pi-ai 适配器：把请求历史与工具结果转成 pi-ai 上下文并交给 SDK | 交给 SDK 前把上下文字符串变为合法文本，且早于前缀摘要计算 |

依赖边：

- 无新增或删除。`dsh-llm-deepseek` 与 `dsh-llm-pi-ai` 本来就依赖 `dsh-util-values`，本 PR 只在既有边上增加调用。
- 反向边：`dsh-util-values` 的运行时依赖里没有这两个适配器。

调用流程：

```ts
// dsh-llm-deepseek
const payload = JSON.stringify(toWellFormedValue({ ...body, ...extensions.fields }))
// dsh-llm-pi-ai
const converted = toWellFormedValue(await toPiContext(request, ...))
const { context, digest } = bindThinkingToPrefix(converted, model.api, prefixDigests, ...)
```

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 工具结果文本以孤立代理项结尾（DeepSeek） | 请求体带 `\uXXXX` 转义，API 拒绝整个请求体 | 请求体带 U+FFFD，不含未配对转义 | 'sends a tool result that ends with a lone surrogate without an unpaired escape' |
| 用户文本以孤立代理项结尾（pi-ai） | 交给 SDK 的上下文带未配对转义 | 上下文带 U+FFFD | 'sends text that ends with a lone surrogate without an unpaired escape' |
| 同一段文本里的完整星形字符 | 原样发送 | 不变 | 'keeps a complete astral character in the same text unchanged'（两个适配器各一） |
| 没有孤立代理项的值 | 原样发送 | 返回同一个对象与同一个字符串，字节不变 | 'returns a value without a lone surrogate unchanged'、'returns the same string when it is already well formed' |
| 嵌套结构里的孤立代理项 | 工具输出原样进入请求体 | 数组与记录中的字符串一并替换，输入不被修改 | 'replaces lone surrogates in nested strings and leaves the input untouched' |
| class 实例或 buffer | 原样进入请求体 | 原样带过，不做深拷贝 | 'carries an object that is not a record or array over as it stands' |

负控：把 `packages/llm/llm-deepseek/src/request-extensions.ts` 与 `packages/llm/llm-pi-ai/src/adapter.ts` 用 `git checkout HEAD -- <path>` 还原到修复前，两个新增用例失败（请求体仍带未配对的转义）；应用实现后全绿。

**Test entries**:

- `pnpm exec vitest run packages/util/values packages/llm/llm-deepseek packages/llm/llm-pi-ai --maxWorkers=2` — 62 个文件、1432 个用例通过（本机）。
- `pnpm run build` — 10 个 gate 通过（本机）。
- `pnpm run typecheck` — 5 个 gate 通过（本机）。
- `pnpm run lint` — 通过（本机）。
- `pnpm run doc-sync` — 41 个 gate 通过，2 个失败（本机）。两个失败都来自上游 master，与本改动无关：`tool catalog` 报 `tool-working-directory` 未列入 `scripts/gen-tool-catalog.ts` 的 `TOOL_PACKAGES`；`package paths` 报 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/guide.md` 指向不存在的 `packages/experimental/ptc-runtime-python/README.md`。本改动没有触及这两处。
- 推送时的 pre-push typecheck — 通过（本机）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 逐条核对报告的根因，确认 `JSON.stringify` 的转义本身合规、失败发生在 API 侧解析器上，并确认持久化日志保留原始码元。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「在出站请求体上做替换」的方向：不动持久化格式，改动只落在两个适配器与一个工具包。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计行为矩阵与负控，并用还原源文件的方式证明新用例在修复前失败。 |
| implementation 技术实现 | auto 模型自主 | 100% | 工具函数、两个适配器的调用点与三处双语 README 由 Agent 编写，配对已重新记录。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
