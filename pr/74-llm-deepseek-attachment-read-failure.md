## Motivation

上游 Discussion #14482 报告：会话历史引用的图片附件对象从 `$DSH_HOME/attachments` 消失后，DeepSeek Messages 路由的每次请求都在本地读附件时失败，却被报告为可重试的 `TRANSPORT`（“DeepSeek Messages transport failed”），白跑 5 次退避后结束 turn，并把用户引向网络排查。

Refs #14482

## Changes

**Interface changes**:

None。没有新增或删除失败码、配置项、导出或协议字段。

**Behavior changes**:

- `dsh-llm-deepseek` 的 Messages 流在兜底包装前，原样抛出任何 `HarnessError`（此前只放行 `LlmError`）。附件对象缺失因此以附件存储给出的 `ATTACHMENT_NOT_FOUND`（“Attachment object is missing.”）失败；该码不在默认 `retryableCodes` 中，不再触发 5 次空转重试，也不会发出 Messages 请求。
- 未编码的异常（`fetch` 的 `TypeError`、连接中断、非 Error 拒绝、凭据 `revoked` 信号的 `DOMException`）仍包装为 `TRANSPORT`；超时与调用方中止的分类不变。
- 同一规则也适用于请求准备阶段其他已编码失败，例如凭据存储抛出的 `HarnessError`：它们此前被改写为可重试的 `TRANSPORT`，现在保留自身 code。这与 `dsh-llm-pi-ai` 适配器的现有行为一致（该适配器本就原样抛出附件读取失败）。
- `README.md` / `README.zh.md` 的失败码段落补充了这条规则。

**Module responsibilities and dependencies**:

None。没有新增或删除包，也没有新增或删除工作区包之间的运行时依赖；`HarnessError` 来自已依赖的 `@deepseek-ai/dsh-llm` 重导出。

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 历史含图片、附件库目录被移走（报告的复现步骤） | finish 为 `TRANSPORT` / “DeepSeek Messages transport failed”（负对照已复现） | finish 为 `ATTACHMENT_NOT_FOUND` / “Attachment object is missing.”，Messages 端点收到 0 个请求 | `adapter.spec.ts`：`reports a missing attachment object by its attachment code without contacting the provider`（真实 `dsh-attachment-local` + `DeepSeekAuth` + API-key 路由组合） |
| `fetch` 抛 `TypeError`、连接拒绝、非 Error 拒绝、响应体中途关闭 | `TRANSPORT` | `TRANSPORT` | 既有 `adapter.spec.ts` `classifies a transport failure`、`runtime.spec.ts` `maps connection failures to TRANSPORT …`、`renders a non-Error transport rejection …`、`classifies an abrupt body close as TRANSPORT` |
| 凭据 `revoked`（无回调）、重定向拒绝 | `TRANSPORT` | `TRANSPORT` | 既有 `reports a withdrawal the provider does not name as a transport failure …`、`refuses redirects before credentials reach another origin …` |
| 默认重试策略 | 重试 `TRANSPORT` | `ATTACHMENT_NOT_FOUND` 不在 `DEFAULT_RETRYABLE_CODES`（`dsh-llm/src/retry-policy.ts`）中，不重试 | 策略表本身未改动 |

**Test entries**（全部为本地运行，基于上游 `master` `841f76d3c5`）:

- 负对照：先在未修改的 `adapter.ts` 上运行新用例，失败并收到 `TRANSPORT` / “DeepSeek Messages transport failed”，与报告一致；加入修复后通过。
- 包测试：`pnpm exec vitest run packages/llm/llm-deepseek packages/llm/llm-deepseek-api-key packages/llm/llm-deepseek-account --maxWorkers=2`：34 个文件、815 个测试通过。
- 覆盖率：`--coverage.include='packages/llm/llm-deepseek/src/adapter.ts'`：语句、分支、函数、行均为 100%。
- 静态与文档：`pnpm run lint` 通过；`pnpm run test:docs` 21 个 gate 通过；`verify-translation-pairing --write packages/llm/llm-deepseek/README.md` 已重录；pre-push 的 typecheck（5 个 gate）通过。

<details><summary>Proof</summary>

```
# 负对照（修复前）
FAIL adapter.spec.ts > Cordis provider composition > reports a missing attachment object by its attachment code without contacting the provider
-       "code": "ATTACHMENT_NOT_FOUND",
-       "message": "Attachment object is missing.",
+       "code": "TRANSPORT",
+       "message": "DeepSeek Messages transport failed",

# 修复后
$ pnpm exec vitest run packages/llm/llm-deepseek packages/llm/llm-deepseek-api-key packages/llm/llm-deepseek-account --maxWorkers=2
 Test Files  34 passed (34)
      Tests  815 passed (815)
$ ... --coverage --coverage.include='packages/llm/llm-deepseek/src/adapter.ts'
Statements   : 100% ( 96/96 )
Branches     : 100% ( 60/60 )
Functions    : 100% ( 22/22 )
Lines        : 100% ( 81/81 )
$ pnpm run lint        # exit 0
$ pnpm run test:docs   # 21 passed, 0 failed
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 在 master 上确认附件存储已抛 `ATTACHMENT_NOT_FOUND`，问题只在 Messages 流的兜底包装 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择放行所有 `HarnessError` 以与 pi-ai 适配器对称，未新增失败码 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 用真实附件存储按报告步骤复现，并先做负对照 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 完成一行分类改动、测试与 README 双语段落 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
