## Motivation

`web_fetch` 的本地 HTTP 提供方只解码少数文本媒体类型：脚本源码常以 `application/javascript` 返回（RFC 9239 已废弃该类型，但服务器普遍如此），于是被当成二进制拒绝；而二进制拒绝的消息直接拼接原始 `Content-Type` 标头，把参数与重复标头泄露给模型，并且没有给出任何可行的替代路径，模型只能对同一 URL 重试（Discussion #14432）。

## Changes

**Interface changes**: None.

**Behavior changes**:

- `application/javascript` 与 `application/ecmascript` 现在按文本解码；`text/javascript` 仍由既有的 `text/*` 分支覆盖，不重复列出。`application/x-javascript` 与 `application/jsonp` 仍不支持。
- 拒绝消息不再拼接原始标头，而是写明解析后的媒体类型、说明只有文本正文会被解码，并给出可行路径：文档类正文（PDF、Office、不透明二进制）提示先保存到文件再用文档工具打开，其余二进制提示改抓文本或 HTML 版本。缺少 `Content-Type` 时仍标为 `"unknown"`。
- 错误码 `WEB_UNSUPPORTED_CONTENT_TYPE` 与 charset 失败的文案不变。
- 包 README（中英双语）记录新的可解码集合与新的拒绝消息。

**Module responsibilities and dependencies**: None.

**Direction decisions**（对应 Discussion #14432 的四个待决问题）：

1. **脚本媒体类型的范围**：只接受 `application/javascript` 与 `application/ecmascript`。`application/x-javascript`、`application/jsonp` 是近乎同义的历史别名，报告的账本里也没有观测到，保持不支持。`Accept` 请求头保持不变——它影响服务器愿意返回什么，不影响提供方如何分类已经返回的响应。
2. **拒绝消息的措辞与工具命名**：采用通用措辞（报告的选项 a）。提供方无从知道某个部署挂了哪些工具，因此消息只说「保存正文后用文档工具打开」与「改抓文本或 HTML 版本」，不点名 `office_render`/`read_image`，也不依赖尚不存在的下载工具。
3. **PDF 替代路径的范围**：只做消息引导，不新增下载或渲染能力；可提取文本的 PDF 解码仍按包 README 记录为延期工作。
4. **snapshot**：不需要。该消息只在真实抓取到非文本响应时出现，`snapshots/` 中既没有该字符串，也没有 `web_fetch` 场景；模型可见文案由包内单测逐字固定。

**Message shape**：报告提出的文案对所有类型都同时给出「保存」与「改抓文本」两条路径；本分支按文档类与非文档类分别给出一条最贴切的路径，与报告自身对非文档二进制的说明（`fetch a text or HTML version instead`）一致。文档类判定集合与报告一致：`application/pdf`、`application/msword`、`application/vnd.ms-*`、`application/vnd.openxmlformats-officedocument.*`、`application/octet-stream`。重复标头（`application/octet-stream, application/octet-stream`）按单个媒体类型解析。

## Testing

**Test design**（行为矩阵）：

| 场景 | 变更前 | 变更后 | 覆盖用例 |
|---|---|---|---|
| 以 `application/javascript` 返回的 `.js` 资源 | 拒绝，`WEB_UNSUPPORTED_CONTENT_TYPE` | 解码为文本正文 | 新增端到端用例 |
| 以 `application/ecmascript` 返回的脚本 | 拒绝 | 解码为文本正文 | 新增分类断言 |
| 以 `application/x-javascript` 返回的脚本 | 拒绝 | 仍拒绝 | 新增分类断言 |
| 带参数或重复标头的 PDF | 消息为 `unsupported content type "application/pdf; qs=0.001"` | 消息为解析后的媒体类型加替代路径 | 新增消息用例与端到端用例 |
| 非文档二进制 `image/png` | 消息为原始标头 | 消息为 `image/png` 加「改抓文本或 HTML 版本」 | 新增消息用例 |
| 缺少 `Content-Type` | 消息为 `unsupported content type "unknown"` | 消息为 `"unknown"` 加「改抓文本或 HTML 版本」 | 新增消息用例 |
| charset 声明失败 | 不变 | 不变 | 既有用例 |

**Test entries**：

- 本地 `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run packages/web/web-fetch-http/tests --maxWorkers=2 --coverage --coverage.include='packages/web/web-fetch-http/src/**/*.ts'`：3 个文件、112 个测试通过；语句 187/187、分支 130/130、函数 33/33、行 171/171，覆盖率均为 100%。
- 本地 `pnpm exec vitest run packages/web --maxWorkers=2`：web 组 20 个文件、667 个测试通过。
- 反向对照：把 `packages/web/web-fetch-http/src/policy.ts` 与 `src/provider.ts` 还原为 `origin/master`（`git checkout origin/master -- …`）后，4 个用例失败——分类用例、消息用例、以 `application/javascript` 提供脚本资源的端到端用例、逐字断言拒绝消息的端到端用例；恢复修复后全部通过。
- 本地 `NODE_OPTIONS="--max-old-space-size=8192" pnpm run typecheck`：5 个门禁全部通过。
- 本地 `pnpm run lint`：通过。
- 本地 `pnpm run test:docs`：21 通过、0 失败。
- 本地 `pnpm run doc-sync`：41 通过、2 失败。2 个失败均为本仓库既有问题，与本次改动无关：工具目录缺少 `tool-working-directory`，以及 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/guide.md` 仍引用上游已删除的 `packages/experimental/ptc-runtime-python`。
- 推送钩子 typecheck 门禁：5 通过、0 失败。
- 没有 CI 结果：上游不接受外部 PR，因此分支暂存在 fork。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复核上游 Discussion #14432 的媒体类型分类与拒绝消息，定位到脚本类型不在可解码集合内、拒绝消息拼接原始标头两处缺口。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定脚本媒体类型集合、文档类判定集合与两类替代路径的措辞，并逐条回答报告提出的四个待决问题。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计分类、消息逐字断言与两个端到端用例，跑包内覆盖率、web 组测试与一组反向对照。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 实现媒体类型解析、消息构造与提供方调用，补齐中英双语的 README。 |
| review 评审处理 | n/a 暂不适用 | — | No review comments have been handled. |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
