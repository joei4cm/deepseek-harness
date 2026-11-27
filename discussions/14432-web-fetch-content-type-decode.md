<!--
Status: draft, not published.
Target: Discussion #14432.
Do not publish without explicit user authorization and a fresh check for new comments.
-->

# English reply (draft)

We took this on against current `master` (`4b399c39a6`) and reproduced both gaps you describe.

What we confirmed: `classifyContentType` accepts `text/html`, `application/xhtml+xml`, every `text/*`, `application/json`, `application/xml` and the `+json`/`+xml` families, so a `.js` resource served as `application/javascript` falls through to the rejection, and the rejection message embeds the raw `Content-Type` header verbatim — `application/pdf; qs=0.001` reaches the model as written. The `WEB_UNSUPPORTED_CONTENT_TYPE` code and the charset failure messages are unchanged by our fix.

Our branch is `fix/web-fetch-content-type-decode` (`224b70321135f39d3a3da8bf376265df2ea3de54`). It is written from your report rather than from your comparison branch, so the wording differs; we did not cherry-pick `Ruiyi-Zhang-BUPT:fix/web-fetch-content-type-ux`, and if you would rather take the branch as it stands, that is your call to make.

Two changes:

- `application/javascript` and `application/ecmascript` now decode as text. `text/javascript` already passed through the `text/*` branch.
- The rejection message names the parsed media type, states that only text-like bodies decode, and names one alternative. For a document-like body (PDF, `application/msword`, `application/vnd.ms-*`, `application/vnd.openxmlformats-officedocument.*`, `application/octet-stream`) it says to save the response body to a file and open it with the document tools; for other binaries it says to fetch a text or HTML version. A missing `Content-Type` still reads `"unknown"`. The document set is the one you listed.

Our wording for a document-like body is `unsupported content type "application/pdf": only text-like bodies decode; save the response body to a file (for example with a shell download) and open it with the document tools`, and for `image/png` it is `unsupported content type "image/png": only text-like bodies decode; fetch a text or HTML version of this resource instead`. Your proposal offers both alternatives for every type; we give the one that fits, which matches the non-document wording you described.

On your four questions: we took the generic wording, so the message names neither `office_render` nor `read_image` — the provider cannot know which tools a deployment mounts. We kept the scope to the message, with no download or render capability and no change to the deferred PDF decoding. We did not add `application/x-javascript` or `application/jsonp`; they are near-synonym historical aliases with no occurrence in your ledger. We left the `Accept` header alone, since it shapes what a server offers rather than how the provider classifies what came back. And we did not add a recorded snapshot: the message appears only when a fetch really returns a non-text body, `snapshots/` contains neither the string nor a `web_fetch` scenario, and the model-visible text is pinned verbatim by unit tests instead.

Validation: the package suite passes (3 files / 112 tests) with 100% statement, branch, function, and line coverage of the package source; the new cases fail against `master`'s source; the whole web group passes (20 files / 667 tests); host typecheck, lint, and the documentation gates pass. `pnpm run doc-sync` reports 2 failures, both pre-existing in the repository and unrelated to this diff (the tool catalog is missing `tool-working-directory`, and an upgrade guide still links the removed `packages/experimental/ptc-runtime-python`).

Upstream does not accept external pull requests, so the branch carries no CI result.

# 中文对照（仅供阅读，不发布）

我们对照当前 `master`（`4b399c39a6`）核对了这两个缺口，两者都能复现。

确认的部分：`classifyContentType` 接受 `text/html`、`application/xhtml+xml`、全部 `text/*`、`application/json`、`application/xml` 以及 `+json`/`+xml` 家族，因此以 `application/javascript` 返回的 `.js` 资源会落到拒绝分支；而拒绝消息原样拼接 `Content-Type` 标头，`application/pdf; qs=0.001` 会原样到达模型。我们的改动不动 `WEB_UNSUPPORTED_CONTENT_TYPE` 错误码，也不动 charset 失败的消息。

分支是 `fix/web-fetch-content-type-decode`（`224b70321135f39d3a3da8bf376265df2ea3de54`）。这份实现依据你的报告写成，没有取用你的对比分支，因此措辞不同；我们没有 cherry-pick `Ruiyi-Zhang-BUPT:fix/web-fetch-content-type-ux`，是否直接采用以你的判断为准。

两处改动：

- `application/javascript` 与 `application/ecmascript` 现在按文本解码；`text/javascript` 本来就由 `text/*` 分支覆盖。
- 拒绝消息写明解析后的媒体类型，说明只有文本正文会被解码，并给出一条替代路径。文档类正文（PDF、`application/msword`、`application/vnd.ms-*`、`application/vnd.openxmlformats-officedocument.*`、`application/octet-stream`）提示把响应正文保存到文件后用文档工具打开；其余二进制提示改抓文本或 HTML 版本。缺少 `Content-Type` 时仍写 `"unknown"`。文档类判定集合与你列出的一致。

文档类正文的消息是 `unsupported content type "application/pdf": only text-like bodies decode; save the response body to a file (for example with a shell download) and open it with the document tools`，`image/png` 的是 `unsupported content type "image/png": only text-like bodies decode; fetch a text or HTML version of this resource instead`。你的方案对所有类型都同时给出两条路径，我们只给最贴切的一条，这与非文档二进制的措辞与你描述的一致。

关于你的四个问题：我们采用通用措辞，消息不点名 `office_render` 或 `read_image`——提供方无从知道某个部署挂了哪些工具。范围只到消息，不新增下载或渲染能力，可提取文本的 PDF 解码仍是延期工作。我们没有加入 `application/x-javascript` 与 `application/jsonp`，它们是近乎同义的历史别名，你的账本里也没有观测到。`Accept` 请求头保持不变，它影响服务器提供什么，不影响提供方如何分类已返回的响应。我们没有新增 recorded snapshot：这条消息只在真实抓取到非文本正文时出现，`snapshots/` 里既没有该字符串，也没有 `web_fetch` 场景，模型可见文案由单测逐字固定。

验证：包内测试全绿（3 个文件 / 112 个测试），包源文件的语句、分支、函数、行覆盖率均为 100%；新增用例在 `master` 的源码下失败；整个 web 组测试通过（20 个文件 / 667 个测试）；host typecheck、lint 与文档门禁通过。`pnpm run doc-sync` 有 2 个失败，都是仓库既有问题，与本次改动无关（工具目录缺少 `tool-working-directory`，以及一份升级指南仍链接已删除的 `packages/experimental/ptc-runtime-python`）。

上游不接受外部 PR，因此该分支没有 CI 结果。
