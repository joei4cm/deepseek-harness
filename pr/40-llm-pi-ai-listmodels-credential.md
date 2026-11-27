## Motivation

`llm-pi-ai` 的 `listModels` 在路由的命名凭据解析失败时吞掉 `MISSING_CREDENTIAL` 并返回空模型列表——与「已配置但零模型」的路由返回完全相同的结果，调用方无法区分「未存密钥」和「没有模型」，模型目录里该提供方既不出现为分组也不出现为失败行。Refs #14394

## Changes

**Interface changes**: None。`listModels` 的签名与返回类型不变；变化的只是失败路径——原本静默的 `[]` 现在以与流式调用相同的 `LlmError` 拒绝。

**Behavior changes**:

- 路由的 `apiKeyEnv` 引用解析为空（或凭据解析以其他错误失败）时，`listModels` 以同一错误对象拒绝，不再返回 `[]`；这与同一路由的流式调用（`prepareCall` 内无 catch 的 `resolveApiKey`）行为一致。
- 各既有消费方的可见结果：模型目录（`session/modelCatalog`）把该提供方从「无分组无失败」变为带原因的 failure 行（`ui-model-selection` 渲染 failures）；`modelAvailable` 的 `session/model-unavailable` 带上真实原因；ACP 模型控制按既有 per-provider catch 跳过该分组；subagent 的 list-models 工具从「no advertised models」变为携带 `MISSING_CREDENTIAL` 的失败——与同文件 `resolveModelInfo` 路径的失败口径一致。
- 实验性 translator 的探针在 `listModels` 之前已用 `credentials.describe().configured` 预过滤凭据缺失；残余竞争路径被 `availablePaidProviders` 与翻译主流程的 try/catch 包含，无新增未处理 rejection。
- DeepSeek 官方适配器不受影响：其 `listModels` 来自配置声明，无凭据门。

**Module responsibilities and dependencies**: None。改动只落在 `packages/llm/llm-pi-ai` 的 `src/adapter.ts`、其测试与双语 README，没有包间依赖边变化。

**文档**: `llm-pi-ai` README 双语对在凭据引用描述中补充「`listModels` 枚举以同一失败拒绝」，已重录 translation pairing。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| `resolveApiKey` 以 `LlmError MISSING_CREDENTIAL` 拒绝 | `listModels` 返回 `[]` | 以同一错误对象拒绝 | `propagates the credential failure from listModels unchanged: missing credential` |
| `resolveApiKey` 以 `INVALID_CREDENTIAL` / 非 LlmError 拒绝 | 拒绝（透传） | 不变：仍以同一错误对象拒绝 | 同参数化用例另两个参数（原行为保留，断言合并） |
| 凭据正常 / 路由未配置模型等既有路径 | 既有契约 | 不变 | 包内 23 个测试文件 508 用例全绿 |
| 适配器 rejection → 目录 failure 行（组合层） | 既有管道 | 喂入真实 rejection，行为不变 | `session-models.host.spec.ts` 既有 failures 断言（fake 适配器覆盖同一管道） |

负控：把 `packages/llm/llm-pi-ai/src/adapter.ts` 备份到 /tmp 后用 `git checkout origin/master -- <path>` 还原到修复前，`propagates the credential failure…: 'missing credential'` 用例失败（旧实现 resolve 为 `[]` 而非拒绝），另两个参数（原有透传行为）在旧源上通过——精确证明被改写的正是 MISSING_CREDENTIAL 分支。

**Test entries**:

- `pnpm exec vitest run packages/llm/llm-pi-ai/tests/ --maxWorkers=2` — 23 个文件、508 个用例通过（本机）。
- `pnpm run build` — 10 个 gate 通过（本机）。
- `pnpm run typecheck` — 5 个 gate 通过（本机）。
- `pnpm run lint` — 通过（本机）。
- `pnpm run doc-sync` — 除 `tool catalog`、`package paths` 两个上游 master 既有失败外全部通过（与本改动无关，见 PR 38/39 同项披露）。
- `pnpm run verify-translation-pairing packages/llm/llm-pi-ai/README.md` — 1 对一致。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: copilot](https://img.shields.io/badge/䷼%20AI--DECLARATION-copilot-fee2e2?labelColor=fee2e2)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `copilot`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 对照 master 源码复核报告定位（`adapter.ts:347-364` 与报告一致），盘点全部 6 处 `listModels` 消费方的失败处理。 |
| design 方案设计 | copilot 人工把关 | 60% | 传播 `MISSING_CREDENTIAL` 的方向来自讨论中报告者的期望行为（并与其插件 workaround 相互印证）；Agent 确定范围（只动 pi-ai 适配器）、消费方安全论证与「空列表掩盖原因」的理由。 |
| testing 验收测试 | auto 模型自主 | 100% | 重写钉住旧行为的参数化用例并做负控（还原修复前源码，MISSING_CREDENTIAL 用例以 `[]` 失败）。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 完成全部源码、测试与双语 README 改动；作者未做 diff 审阅。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
