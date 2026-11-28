# #14482 — missing attachment objects reported as TRANSPORT (draft, unpublished)

Status: the one-line takeover claim was denied by the permission classifier (needs explicit user authorization for #14482). This reply is an unpublished draft.

## English

Thanks for the precise report — it reproduces on current `master` (`841f76d3c5`) exactly as described.

On `master` the local attachment store already reports a missing object as `ATTACHMENT_NOT_FOUND` ("Attachment object is missing."), so your suggestions 1 and 2 are already in place one layer down. The defect is only in the DeepSeek Messages stream: its last-resort `catch` passed through `LlmError` alone and rewrote every other error, including that coded attachment failure, as the retryable `TRANSPORT`. The pi-ai adapter already lets the attachment error through unchanged.

The fix (branch `fix/llm-deepseek-attachment-read-failure`) passes through any coded `HarnessError` before the `TRANSPORT` fallback. The missing-attachment case now fails at once with `ATTACHMENT_NOT_FOUND`, which the default retry policy does not retry, and no Messages request is sent. Uncoded failures (fetch `TypeError`, connection resets, abrupt body close, an unnamed credential withdrawal) stay `TRANSPORT`. A regression test follows your steps with the real attachment store: save an image, move `attachments/` away, stream — it failed with `TRANSPORT` before the fix and gets `ATTACHMENT_NOT_FOUND` after.

Not changed: suggestion 3 (a one-time attachment-root check at request start) — with the coded failure the first request already names the cause, so a separate probe adds no information. The message does not include the attachment id or host path; the attachment store deliberately keeps host paths out of error messages.

## 中文

感谢精确的报告——在当前 `master`（`841f76d3c5`）上按描述完全复现。

`master` 上本地附件存储已把对象缺失报告为 `ATTACHMENT_NOT_FOUND`（“Attachment object is missing.”），所以建议 1、2 在下一层已经具备。缺陷只在 DeepSeek Messages 流：它的兜底 `catch` 只放行 `LlmError`，其余错误（包括这个已编码的附件失败）一律改写为可重试的 `TRANSPORT`。pi-ai 适配器本就原样抛出该附件错误。

修复（分支 `fix/llm-deepseek-attachment-read-failure`）在 `TRANSPORT` 兜底之前放行任何已编码的 `HarnessError`。附件缺失现在立即以 `ATTACHMENT_NOT_FOUND` 失败，默认重试策略不重试，也不会发出 Messages 请求。未编码的失败（fetch `TypeError`、连接重置、响应体中途关闭、未被命名的凭据撤回）仍为 `TRANSPORT`。回归测试按你的步骤使用真实附件存储：保存图片、移走 `attachments/`、发起请求——修复前得到 `TRANSPORT`，修复后得到 `ATTACHMENT_NOT_FOUND`。

未做：建议 3（请求开始时一次性检查附件根目录）——有了已编码失败，第一次请求就已点明原因，单独探测不增加信息。错误消息不含附件 id 或主机路径；附件存储有意不把主机路径放进错误消息。
