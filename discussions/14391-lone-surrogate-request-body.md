<!--
状态：草稿，未发布。
用途：Discussion #14391 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/llm-request-lone-surrogate` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）。
-->

# English reply (for posting to Discussion #14391)

Your root-cause analysis is right, and I confirmed the last mile of it on current `master` (`4b399c39a6`): the request body carries the escape, and the escape is what the API rejects.

I rebuilt the same body the way `serialize()` builds it — system message to the top-level `system`, tool results merged into the following user turn as `tool_result.content[0]`, thinking and tool-use replay — from a history whose tool result ends with half an astral character, and the JSON text contains the unpaired `\uXXXX` escape inside `messages[n].content[0].content[0].text`, exactly as you describe. `JSON.stringify` is spec-correct there (ES2019 well-formed stringify), and the body is valid JSON per RFC 8259; the failure is the gateway's stricter parser rejecting unpaired surrogates and the whole body with them. Nothing in the harness truncates that text on the way out.

What my branch changes is the boundary where the body leaves the adapter:

- `dsh-llm-deepseek` makes every string of the request body well formed before it serializes the HTTP payload, base body and plugin-contributed extension fields together.
- `dsh-llm-pi-ai` does the same for the context it hands to pi-ai, and it does so *before* the Anthropic request-prefix digest is computed, so the digest still describes the text that is actually sent.

A lone surrogate becomes U+FFFD, which is the only rendering that code unit has. A request that carries no lone surrogate is sent unchanged, byte for byte.

About your second proposal, sanitizing on the way into the session log: I deliberately did not do that, for two reasons. The log is the durable record of what the tool printed, and its JSONL writer uses `JSON.stringify`, so the line already keeps the code unit recoverable — the escape is valid JSON and reads back as the same lone surrogate. Rewriting the stored text would make the log differ from what the tool produced, and it would not help the sessions that already carry the bad text, since those logs were written before the change. The wire-side replacement does help them: the log stays as it is and the next request simply carries U+FFFD instead of the unpaired escape. So a session that is bricked today recovers with its next turn, and the zstd surgery in your recovery section is not needed — although it remains a valid repair for the logs themselves.

The model sees U+FFFD where the tool printed half a character, and the log keeps the original bytes; that is the one visible consequence of the choice.

Your third proposal, surfacing the 400 as "session history contains invalid Unicode" with an offered repair, is not in this change: with the replacement in place this particular 400 no longer happens. A diagnostic for a JSON-parse rejection would need to cover the other ways a body can fail to parse, and that is a separate decision about how the adapter reports provider-side parse failures. I would rather not invent that message here.

The asymmetry you point at is real and worth keeping in mind: DSH's own caps are surrogate-aware since #4817, but model-written code that slices a string by code unit (`title.slice(0, 70)`) can still cut a pair in half, and the harness cannot know which of its many text producers did that. Replacing at the request boundary covers every source at once, which is why I put it there rather than in the tool layer.

The branch is `fix/llm-request-lone-surrogate`, based on upstream `master`. Package suites, build, typecheck, lint and the documentation gates pass (two documentation gates fail on upstream `master` for unrelated reasons: a tool package missing from the tool-catalog manifest and a stale path in an old upgrade guide). A full pull-request description is ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

If your case hits a path I did not cover — a provider route that does not go through these two adapters, for instance — I would like to see the request body, because that would tell me which seam still lets the escape through.

# 中文对照（仅供作者阅读，不发布）

你的根因分析是对的，我也在当前 `master`（`4b399c39a6`）上确认了最后一环：请求体里确实带着那个转义，而被 API 拒绝的正是它。

我按 `serialize()` 的方式重建了同样的请求体——系统消息进顶层 `system`，工具结果并入随后的 user 轮次作为 `tool_result.content[0]`，thinking 与 tool_use 回放——历史里放一个以半个星形字符结尾的工具结果，JSON 文本里就出现了未配对的 `\uXXXX` 转义，位置与 `messages[n].content[0].content[0].text` 都和你描述的一致。`JSON.stringify` 在这里符合规范（ES2019 的 well-formed stringify），按 RFC 8259 这仍是合法 JSON；失败的是网关更严格的解析器：它拒绝未配对的代理项，并把整个请求体一起拒掉。harness 这一侧没有任何截断会在出站时改掉这段文本。

我的分支改的是请求体离开适配器的那条边界：

- `dsh-llm-deepseek` 在序列化 HTTP 载荷之前，把请求体里的每个字符串变为合法文本，基础请求体与插件贡献的扩展字段一并处理。
- `dsh-llm-pi-ai` 对交给 pi-ai 的上下文做同样处理，而且处理发生在 Anthropic 请求前缀摘要计算**之前**，摘要描述的仍然正是发出去的文本。

孤立代理项变成 U+FFFD——那是该码元唯一可能的呈现。不含孤立代理项的请求逐字节不变。

关于你的第二条提议（在写入 Session 日志时做替换）：我没有这么做，有两个理由。日志是工具输出本身的持久记录，它的 JSONL 写入用 `JSON.stringify`，因此那一行本来就保留着可还原的码元——那个转义是合法 JSON，读回来仍是同一个孤立代理项。改写存储的文本会让日志与工具实际打印的内容不一致，而且救不了已经写入坏文本的会话：那些日志写在改动之前。放在出站一侧替换则能救：日志保持原样，下一次请求带上的是 U+FFFD 而不是未配对的转义。于是今天已经报废的会话在下一个轮次就能继续，你恢复一节里那段 zstd 手术对日志本身仍然有效，但已经不是必需的了。

代价只有一个：模型看到的是 U+FFFD，日志保留原始字节——这正是这个选择的可见后果。

你的第三条提议（把 400 呈现为「会话历史含非法 Unicode」并提供修复入口）不在这次改动里：有了替换，这个 400 就不再发生了。为 JSON 解析失败做专门诊断，还要覆盖请求体解析失败的其他成因，那是适配器如何报告提供方侧解析失败的另一项决定，我不愿在这里凭空造一条文案。

你指出的不对称确实存在，值得记住：自 #4817 起 DSH 自己的截断已经对代理项友好，但模型写的代码按码元切字符串（`title.slice(0, 70)`）仍可能把一对字符切成两半，而 harness 无法知道是众多文本产出者中的哪一个干的。在请求边界替换一次覆盖所有来源，这就是我把它放在那里而不是工具层的原因。

分支是 `fix/llm-request-lone-surrogate`，基于上游 `master`。包套件、build、typecheck、lint 与文档门禁均通过（有两个文档门禁在上游 `master` 上因无关原因失败：工具目录清单缺一个工具包、旧升级指南里有一条失效路径）。完整 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。

如果你的场景落在我没有覆盖的路径上——比如某个不经过这两个适配器的提供方路由——我很想看到那份请求体，它能告诉我还有哪条缝让转义漏了过去。
