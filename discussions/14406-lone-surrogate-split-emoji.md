<!--
状态：草稿，未发布。
用途：Discussion #14406 的回复正文，供作者过目后决定是否发布。
说明：#14406 与 #14391 是同一个缺陷的两次独立报告（不同报告者）。修复已落在 fork 的 `fix/llm-request-lone-surrogate` 分支，本回复只说明「已修 + 修在哪 + 不做什么」，不重复 #14391 草稿的完整论证。
核对基线：上游 master（4b399c39a6）。
-->

# English reply (for posting to Discussion #14406)

This is the same defect as #14391, reported independently, and it is already fixed on our fork. Your mechanism section matches the code exactly, so this reply only records where the fix landed and what it deliberately does not do.

The two adapters that serialize a provider request body are the whole seam, and both now carry only well-formed text:

- `dsh-llm-deepseek` (`src/request-extensions.ts`) wraps the value it serializes into the HTTP payload — the merged base body plus plugin-contributed extension fields, and also the fallback payload used when the merge fails to serialize. That is the `JSON.stringify` you named.
- `dsh-llm-pi-ai` (`src/adapter.ts`) wraps the context it hands to pi-ai, and it does so before the Anthropic request-prefix digest is computed, so the digest still describes the text that is sent.

The replacement is `toWellFormedText` / `toWellFormedValue` in `dsh-util-values` (`String.prototype.isWellFormed` / `toWellFormed`, both in Node 24): a lone surrogate becomes U+FFFD, which is the only rendering that code unit has, and a request that carries no lone surrogate is sent byte for byte unchanged. It is a copy-on-change deep walk, so a clean request does not pay for a rebuild.

Three notes on the specifics you raised:

- `truncateJsonStringBytes()` in `ptc-runtime-node/src/output-json.ts` being code-point aligned is correct and is not the seam. The ill-formed string is produced by the model's own `slice`, before any truncation helper sees it, which is why the fix sits at the request boundary rather than in the tool layer — one boundary covers every producer at once.
- The bad code unit is deliberately left in the journal. The JSONL writer uses `JSON.stringify`, so the stored line keeps the code unit recoverable and reads back identically; rewriting stored text would desync the log from what the tool printed and would not help sessions written before the change. Because the wire is sanitized instead, a session bricked today recovers on its next turn — retrying, typing "continue", restarting, or compacting all work again — and the hand-edit of `\ud83d` to `�` in `session.v4.jsonl.zstd` is no longer needed, though it remains a valid repair for the log itself. Compaction requests go through the same adapter, so surviving five compactions does not preserve the failure.
- The 400 is classified `INVALID_REQUEST`, which is not a retryable code, so a bricked session does not also burn a retry storm.

What the change does not do: it does not rewrite the journal, does not add a self-healing scan on a 400, and does not translate the provider's `messages[920].content[0].content[0].text` path into user-facing copy. With the replacement in place this particular 400 no longer occurs; a diagnostic for provider-side JSON parse failures would have to cover the other ways a body can fail to parse, and the copy is a product decision.

The branch is `fix/llm-request-lone-surrogate`, based on upstream `master`. Package suites, build, typecheck, lint and the documentation gates pass (two documentation gates fail on upstream `master` for unrelated reasons). `CONTRIBUTING.md` states that external pull requests are not accepted, so the branch is published on our fork rather than opened upstream.

# 中文对照（仅供作者阅读，不发布）

这和 #14391 是同一个缺陷的两次独立报告，修复已经落在我们的 fork 上。你的机制分析与代码完全一致，所以这里只记录修复落在哪里，以及它刻意不做什么。

会序列化提供方请求体的适配器只有这两个，它们现在都只携带合法文本：

- `dsh-llm-deepseek`（`src/request-extensions.ts`）包裹的是它序列化进 HTTP 载荷的那个值——合并后的基础请求体加插件贡献的扩展字段，合并序列化失败时使用的兜底载荷也一并包裹。也就是你点名的那个 `JSON.stringify`。
- `dsh-llm-pi-ai`（`src/adapter.ts`）包裹交给 pi-ai 的上下文，且发生在 Anthropic 请求前缀摘要计算之前，摘要描述的仍然是实际发出去的文本。

替换用的是 `dsh-util-values` 里的 `toWellFormedText` / `toWellFormedValue`（`String.prototype.isWellFormed` / `toWellFormed`，Node 24 都有）：孤立代理项变成 U+FFFD——该码元唯一可能的呈现；不含孤立代理项的请求逐字节不变。深拷贝按需发生，干净请求不会为重建付出代价。

对你提出的三个细节各补一句：

- `ptc-runtime-node/src/output-json.ts` 里 `truncateJsonStringBytes()` 按码点对齐是对的，而它不是接缝所在。畸形字符串由模型自己的 `slice` 产生，早于任何截断助手见到它，所以修复放在请求边界而不是工具层——一条边界同时覆盖所有产出者。
- 日志里的坏码元是有意保留的。JSONL 写入用 `JSON.stringify`，存储行保留可还原的码元且读回来完全一致；改写存储文本既会让日志与工具实际打印的内容不一致，也救不了改动之前写入的会话。改为在出站一侧替换之后，今天已经报废的会话在下一个轮次就能恢复——重试、输入「continue」、重启、压缩都重新有效——`session.v4.jsonl.zstd` 里把 `\ud83d` 手改成 `�` 已无必要，尽管它作为日志本身的修复仍然有效。压缩请求走同一个适配器，所以「扛过 5 次压缩」不会保住这个失败。
- 该 400 被归类为 `INVALID_REQUEST`，不是可重试码，所以报废会话不会另外烧掉一轮重试风暴。

这次改动不做的事：不改写日志，不在 400 上做自愈扫描，也不把提供方返回的 `messages[920].content[0].content[0].text` 路径翻译成面向用户的文案。有了替换，这个特定的 400 就不再发生；为提供方侧 JSON 解析失败做诊断需要覆盖请求体解析失败的其他成因，而文案属于产品决定。

分支是 `fix/llm-request-lone-surrogate`，基于上游 `master`。包套件、build、typecheck、lint 与文档门禁均通过（有两个文档门禁在上游 `master` 上因无关原因失败）。`CONTRIBUTING.md` 声明当前不接受外部 PR，因此分支发布在我们的 fork 而不是上游。
