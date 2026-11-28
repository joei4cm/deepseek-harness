## Motivation

Auto review 在每个原生工具调用和每个已启动的 PTC inner 调用执行前，用被评审 Session 的 provider/model 发一次 reviewer 请求；reviewer 复用最新 `request/header.config` 的 provider 与 model，却丢弃了 header 记录的 `reasoningEffort`。LLM runtime 对省略的 effort 回落到模型元数据的 `reasoning.defaultEffort`（`packages/llm/llm/src/index.ts` 的 `effective = requested ?? reasoning.defaultEffort`）；对 thinking-only 路由该默认值是 thinking-disabled，模型无法关闭思考，provider 直接拒绝：

```text
INVALID_REQUEST: {"code":"1210","message":"该模型始终思考，不支持关闭思考；请使用 low、high 或 max。"}
```

reviewer 失败按设计 fail-closed（`Auto review of tool "<name>" failed; its body was not executed`），于是该 Session 的 Auto 模式下每个受审调用都被同一个 400 阻断（Discussion #14422 的证据：4 个会话、63 条同签名失败记录，provider/model 均为 `zai-coding-cn / glm-5.3-flash`，四个 Session 的请求头均记录 `reasoningEffort: "max"`，主 agent 请求同 route、同 effort 正常返回）。

Refs #14422

## Changes

**Interface changes**: None.

**Behavior changes**:

- reviewer 请求现在携带被评审 Session 最新请求头所记录的 `reasoningEffort`：header 记录了 effort 时，reviewer 的 `GenerateOptions` 显式带上该值；header 没有记录 effort 时该字段保持省略，shipped adapter 的默认 reasoning 仍然生效。
- 该变更只影响 Auto review 的 reviewer 请求。被评审 Session 的请求、工具 schema、风险策略与判定结果都不变。
- 失败策略不变：reviewer 失败仍然阻断工具体，不 fail-open、不降级放行。
- 不做 clamp，也不引入新的配置项（见下「Direction decisions」）。
- 文档同步：包 README 中英双语的 reviewer 行为句、`.agents/notes/implemented/feature/2026-08-28-auto-review.md` 及其 `.zh.md` 中的同一事实，两侧 `.i18n.yaml` 记录同步更新。

**Module responsibilities and dependencies**: None.

**Direction decisions**（对应 Discussion #14422 的三条待定问题）：

1. **沿用被评审 Session 的 effort，不 clamp、不新增配置。** header 记录的值正是同一 provider/model route 已经接受过的控制，reviewer 走同一条 route，因此不会向模型发送不受支持的字段。clamp 到 route 支持的最低 thinking 级别会静默改变用户选择的推理档位，与 LLM runtime 明确的「不做 clamping 或 aliasing」相悖；新增 `reviewerReasoningEffort` 配置则会给刻意固定、不可配置的 reviewer 策略再添一个旋钮，并需要额外决定它与 Session effort 的优先关系。若 route 在 header 之后变化导致该值不再受支持，LLM runtime 以 `UNSUPPORTED_REASONING_EFFORT` 拒绝，reviewer 依旧 fail-closed，不会悄悄换档。
2. **若将来倾向 clamp，放在 LLM service 层而不是 auto-review 内。** auto-review 不直接读取 `prepareCall` 的 model-info `configure` 回调；那会让包级实现去挑选一个通用选择逻辑的档位。若维护者希望引入通用的 effort 选择 helper，应作为 LLM service 层的独立能力，而不是本包内的私有分支。
3. **不需要 keyless recorded-session snapshot。** reviewer 请求不进入 Session 日志，不改变模型可见文本或工具 schema；现有 auto-review 录制场景的 reviewer 由测试 fixture 脚本化，并不断言请求控制字段。因此本 PR 只补充包内单元测试。

**Parallel implementation disclosure**: 报告方 `Ruiyi-Zhang-BUPT` 已在自己的 fork 上准备了一个同题实现（分支 `fix/auto-review-reasoning-effort`，提交 `4442edfdcc`，在 Discussion #14059 与 #14422 中给出对比链接）。本分支是独立实现，未导入其任何提交：行为方向一致（沿用 header 的 effort、不 clamp、header 未记录时保持省略、失败策略不变），测试与文档改动各自独立完成。

## Testing

**Test design**（行为矩阵）：

| 场景 | 变更前 | 变更后 | 覆盖用例 |
|---|---|---|---|
| 请求头记录了 effort，route 接受该 effort | reviewer 请求省略 effort → 路由默认 effort 接管 | reviewer 请求携带 header 记录的 effort | 新增用例（带 effort） |
| 请求头没有记录 effort | reviewer 请求省略 effort | reviewer 请求仍然省略 effort（adapter 默认生效） | 新增用例（不带 effort） |
| 被评审 Session 的请求本身 | 不变 | 不变 | 既有用例 |
| reviewer 失败时的工具体处置 | fail-closed 阻断 | fail-closed 阻断（不变） | 既有用例 |
| 风险分类与判定（allow / deny / reason） | 不变 | 不变 | 既有用例 |

**Test entries**:

- 本地 `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run packages/experimental/auto-review/tests/auto-review.spec.ts --maxWorkers=2 --coverage --coverage.include='packages/experimental/auto-review/src/**/*.ts'`：1 个文件、41 个测试全部通过。
- 同一次运行的覆盖率：`packages/experimental/auto-review/src` 语句 326/326、分支 257/257、函数 53/53、行 303/303，均为 100%。
- 反向对照：把 `packages/experimental/auto-review/src/index.ts` 还原为 `origin/master` 后，新增用例失败（reviewer 请求不含 effort），其余用例通过；恢复修复后全部通过。
- 本地 `pnpm run typecheck`：5 个门禁全部通过。
- 本地 `pnpm run lint`：通过（`src/index.ts:415` 的 unused oxlint-disable 警告是 master 既有内容，本 PR 未触碰该行）。
- 本地 `pnpm run doc-sync`：43 通过、0 失败。（此前在本 checkout 观察到的 2 个失败来自已删除包的构建残留目录，已用 `pnpm run clean` 清除，与本次改动无关。）
- 推送钩子 typecheck 门禁：通过。
- 没有 CI 结果：上游不接受外部 PR，因此分支暂存在 fork。
- 端到端证据的限制：本机没有报告方所用的 `zai-coding-cn / glm-5.3-flash` 凭据与路由，无法复现真实 400；新增用例用受控的 route 元数据（`resolveModel` 声明可接受的 efforts 与一个不同的默认 effort）复现「route 默认 effort 是 thinking-disabled」这一结构。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复核上游 Discussion #14422 的定位线索与错误账本，确认 reviewer 省略 `reasoningEffort` 导致路由默认 effort 接管，是 thinking-only 路由系统性阻断的结构性原因。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 采用「沿用 header 记录的 effort、不 clamp、不新增配置」的方案，并决定把 clamp 变体归到 LLM service 层而非本包内。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计带 effort／不带 effort 两类用例，补齐受控 route 元数据，跑包内覆盖率、类型与文档门禁，并做反向对照。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 实现 snapshot 与 GenerateOptions 的 effort 传递，同步 README 与 implemented Agent Note 的中英双语事实与 i18n 记录。 |
| review 评审处理 | n/a 暂不适用 | — | No review comments have been handled. |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
