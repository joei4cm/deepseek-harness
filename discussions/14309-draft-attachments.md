<!--
状态：草稿，未发布。
用途：Discussion #14309 的回复正文，供作者过目后决定是否发布。
说明：仅源码对照（dsh-v0.2.2-alpha.3 vs master），无代码改动；该机制在 master 上已存在。
-->

# English reply (for posting to Discussion #14309)

Thank you for the precise reproduction and the source trace — your analysis is exactly right for the build you ran, and the good news is that this was fixed on master between `0.2.2-alpha.3` and `0.2.3-alpha.2`.

Your code-level reading is correct: the draft snapshot (`snapshotDraft`) serializes text, references, the command token, and quotes — no attachments; `serializeDraftAttachments` exists but only serves the *send* path, so nothing about attachments survives shell teardown in `0.2.2-rc.5`.

What landed on master is close to your option 2, implemented via the existing reference-counting machinery rather than a new attachment table:

- `packages/client/ui-conversation/src/client/input/hub.ts` now holds the **Session scope itself** while a draft has attachments: `draftNeedsHold(input, session)` → `sessions.retain(target, { source: 'draft', connection: false })`. Because the per-session `SessionInputShell` lives in a WeakMap keyed by the binding and is torn down only with the Session scope, the attachment ids and the `draftAttachments` map entries in `conversation` service survive a session switch — the image is still there when you return. `connection: false` means the hold costs no event subscription.
- For the case nothing *can* restore — the attachments are browser-owned (blob URLs / in-memory handles) and a page reload discards them — master adds your option 3: `pagehide` writes a `dsh.composer-draft-attachments-unloaded.<sessionId>` mark, and on the next shell creation the composer shows the `attachments.unavailable` notice instead of silently dropping them.

So: paste → switch → return keeps the image on builds newer than `0.2.2-rc.5` (`0.2.3-alpha.2` and later). A full reload still cannot restore a pasted image — the bytes live in browser memory — and the unload mark is the explicit notification you suggested for exactly that case.

# 中文对照（仅供作者阅读，不发布）

感谢精确的复现和源码追踪——你的分析对你运行的构建完全正确，而且好消息是：这个问题在 master 上 `0.2.2-alpha.3` 与 `0.2.3-alpha.2` 之间已经修复。

你对代码的阅读是准的：草稿快照（`snapshotDraft`）只序列化文本、引用、command token 和引用块——不含附件；`serializeDraftAttachments` 只服务于*发送*路径，所以在 `0.2.2-rc.5` 上附件在 shell 拆除后无处可恢复。

master 落地的方案接近你的选项 2，通过既有的引用计数机制实现，而不是新附件表：

- `packages/client/ui-conversation/src/client/input/hub.ts` 现在在草稿带附件期间**持有 Session 作用域本身**：`draftNeedsHold(input, session)` → `sessions.retain(target, { source: 'draft', connection: false })`。因为每个会话的 `SessionInputShell` 存在以 binding 为键的 WeakMap 里、只随 Session 作用域拆除，`attachmentIds` 和 `conversation` 服务里的 `draftAttachments` 条目在会话切换间存活——切回时图片还在。`connection: false` 意味着这个持有不消耗事件订阅。
- 对无法恢复的情形——附件是浏览器所有的（blob URL / 内存句柄），页面刷新必然丢弃——master 加了你的选项 3：`pagehide` 写入 `dsh.composer-draft-attachments-unloaded.<sessionId>` 标记，下次 shell 创建时 composer 显示 `attachments.unavailable` 提示，而不是静默丢弃。

结论：在 `0.2.2-rc.5` 之后的构建（`0.2.3-alpha.2` 起），粘贴→切会话→切回图片仍在。整页刷新仍然无法恢复已粘贴的图片——字节活在浏览器内存里——而卸载标记正是你建议的那种「不能保留时明确提示」。
