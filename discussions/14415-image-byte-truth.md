<!--
状态：草稿，未发布。
用途：Discussion #14415 的回复正文，供作者过目后决定是否发布。接手声明（一行）已发布；本稿说明我们采取的最小修复（宿主侧字节优先）、未触及的边界，以及留给维护者与作者的产品决定。
核对基线：上游 master（4b399c39a6）。
-->

# English reply (for posting to Discussion #14415)

Your diagnosis matches the code exactly, and we took the minimal option — the host now trusts the bytes. Thank you for the precise report.

**What the tree did.** The client sends the browser's `file.type`, which Chromium derives from the file extension; the local attachment store decoded the same bytes and compared the two, so `IMAGE_TYPE_MISMATCH` fired for every file whose name and content disagreed. One detail your diagnostic pinned down: the client renders that code as "only PNG, JPG, WebP and GIF images are supported" (`packages/client/ui-conversation/src/client/image-labels.ts` maps `INVALID_IMAGE` and `IMAGE_TYPE_MISMATCH` to the same copy), which is why a perfectly ordinary file read as an unsupported format.

**What we changed.** On our fork branch `fix/attachment-image-byte-truth` (upstream `CONTRIBUTING.md` declines external pull requests, so the branch lives on our fork and this discussion is the report-back channel):

- The store derives the image format from the decoded bytes and stores that format; the declared media type is a hint, not a rejection reason. Your `.jpeg`-named WebP now attaches, and the durable reference reports `image/webp`.
- The deployment's accepted media types are checked against the decoded format rather than the declaration, so a refused image now carries `UNSUPPORTED_IMAGE_TYPE` with the format that was actually decoded.
- `read_image` reads a mislabeled file by the format its bytes decode as, instead of failing with the rename-or-convert remedy.

**What we deliberately left alone.** The wire boundary still validates the declared type against the four supported formats before the bytes are read, and the error-code vocabulary is unchanged — `IMAGE_TYPE_MISMATCH` stays in the `AttachmentError` code set, because a store that still compares a declaration with its bytes can raise it. Your client-side re-encode option is the more robust half of the fix and we did not take it: it also makes BMP and AVIF work, which is a product decision about which formats the product accepts rather than a bug fix, and it belongs with the maintainers.

One residual limit worth naming, since it is the same trap in a narrower form: the declared type still reaches the deployment policy before the bytes are decoded, both in the upload path and in `read_image` (which declares the type from the path extension). A deployment whose accepted set is narrower than PNG/JPEG/WebP/GIF can therefore still refuse a file whose bytes would be acceptable. Shipped deployments accept all four, so this does not affect the case you reported.

If your local workaround does more than the format fix — if it is what makes BMP and AVIF work for you — that part is worth stating separately, because it is the part we did not solve.

# 中文对照（仅供作者阅读，不发布）

你的定位与代码完全一致，我们采取了最小方案——宿主侧改为字节优先。感谢这份精确的报告。

**代码树原本的行为。** 客户端发送浏览器给出的 `file.type`（Chromium 按扩展名推导），本地附件存储解码同一批字节后与声明逐字比对，因此凡是文件名与内容不一致的文件都会触发 `IMAGE_TYPE_MISMATCH`。有一处细节正好对应你的诊断标记：客户端把该错误码渲染为「仅支持 PNG、JPG、WebP、GIF 格式的图片」（`packages/client/ui-conversation/src/client/image-labels.ts` 把 `INVALID_IMAGE` 与 `IMAGE_TYPE_MISMATCH` 映射到同一段文案），于是一个再普通不过的文件被说成格式不受支持。

**我们改了什么。** 在我们的 fork 分支 `fix/attachment-image-byte-truth` 上（上游 `CONTRIBUTING.md` 不接受外部 PR，分支发布在 fork，本讨论即回报渠道）：

- 存储层从解码后的字节推导图片格式并按该格式保存；声明的媒体类型退化为提示，不再是拒绝理由。你那个 `.jpeg` 名的 WebP 现在可以附加，持久引用报告 `image/webp`。
- 部署接受的媒体类型改为针对解码出的格式校验，被拒的图片现在给出 `UNSUPPORTED_IMAGE_TYPE` 并写明实际解码出的格式。
- `read_image` 按字节解码出的格式读取错名文件，不再给出改名或转换的补救提示。

**我们有意没有动的部分。** 线路边界仍在读取字节前把声明类型对照四种受支持格式校验；错误码词汇表不变——`IMAGE_TYPE_MISMATCH` 仍在 `AttachmentError` 的错误码集合内，因为仍会比对声明与字节的存储可以抛出它。你们客户端侧重新编码的方案是这个问题更彻底的一半，我们没有采用：它同时会让 BMP 与 AVIF 可用，那属于「产品接受哪些格式」的产品决定，而不是缺陷修复，应与维护者一起决定。

还有一处同源的残留限制值得点明，只是形式更窄：声明类型仍在字节解码之前进入部署策略，上传路径如此，`read_image` 亦然（它按路径扩展名声明类型）。接受集合窄于 PNG/JPEG/WebP/GIF 的部署，仍可能拒绝字节本身可接受的文件。出货部署接受全部四种，因此不影响你报告的那个场景。

如果你们本地的变通办法除了格式修复还做了别的事——比如正是它让 BMP 与 AVIF 可用——那部分值得单独说明，因为那正是我们没有解决的部分。
