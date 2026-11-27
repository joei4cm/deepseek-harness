<!--
状态：草稿，未发布。
用途：Discussion #14429 的回复正文，供作者过目后决定是否发布。本稿确认报告、逐条对照当前 master 与其三条提案、给出我们暂存分支的最窄修复，并把 runtime-throw 余量留给维护者。
核对基线：上游 master（4b399c39a6）；我们的分支 fix/client-bundle-error-text。
注意：接手声明（claim）尚未发布，需作者明确授权后才能发帖；本稿发布前需重查讨论区有无新评论。
-->

# English reply (for posting to Discussion #14429)

Your reading of `main` is correct, and we confirmed the rest against master (`4b399c39a6`): the structural half of the rc.1 failure is already fixed there, and the remaining half is exactly the message quality you named in proposal 1.

**What master already does.** When a shared batch script dies, the rows it never registered fall back to their own one-resource URLs inside the same import (`system.ts` `arrive`), so an innocent entry activates and never reaches the audit — the rc.1 "innocent named, culprit invisible" report can no longer be produced. The row whose own code is broken fails its own import, and `recordingImportError` keys the failure under its own id, so the audit names the culprit, marks `(required)` failures as fatal, and only warns for optional ones. Your proposals 2 and 3 are therefore already in: the fallback settles before `assertEntriesActive` runs, and collateral rows either recover or carry their own recorded error.

**What was still missing, and what we changed.** The page script transport discarded the browser's `ErrorEvent.message` on the script `error` event, so a parse error was reported as `bundle script <url> failed to load` with the only copy of the real `SyntaxError` left in the console. Our branch `fix/client-bundle-error-text` appends that message when the browser reports one: `client-modules: bundle script <url> failed to load: SyntaxError: Unexpected token ':'`. The text flows through the arrival attempt chain into the row's recorded import error and the boot report, so the fatal error or warning now names the culprit's actual syntax error. Failures without a message (network) keep the unchanged text; retry-once, the never-re-execute rule for executed batches, and per-row fallbacks are untouched.

**What we deliberately did not take.** Proposal 1's runtime-throw half: a script that parses, registers some rows, and then throws still resolves the transport (the throw surfaces as a window error), because treating it as transport failure would re-execute the batch on the next importer's retry and replay top-level code before stopping at the first duplicate registration — the never-re-execute rule exists to prevent exactly that. For those throws the report still says `loaded without registering …` and the original text remains console-only. Surfacing it needs the `ScriptRealm.execute` contract to carry an execution-error result across every carrier, which is a seam decision we left to maintainers.

Evidence: `packages/client/modules` suite passes 8 files / 271 tests including two new page-transport cases (message carried into the rejection and the import record; no-message text unchanged); with master's transport restored the message case fails (negative control) and passes again after the fix; the boot audit spec passes 14/14; lint and typecheck pass; no snapshot pins the old text. Upstream declines external pull requests, so the branch is staged on our fork with no CI result. We have not reproduced your Windows/rc.1 environment; the claims above are from master source and its tests.

# 中文对照（仅供作者阅读，不发布）

你对 `main` 的解读是正确的，我们又在 master（`4b399c39a6`）上核对了其余部分：rc.1 故障的结构性一半在那里已经修复，剩下的一半正是你提案 1 点到的消息质量。

**master 已经做到的。** 共享批脚本死亡后，未被注册的行会在同一次导入里落到各自的单资源 URL（`system.ts` 的 `arrive`），无辜条目因此恢复激活、根本不会进审计——rc.1 那种「无辜插件被点名、真凶不可见」的报告在 master 上无法再产生。自身代码损坏的行会让自己那次导入失败，`recordingImportError` 把失败记在它自己的 id 下，审计因此指向肇事行，必选失败标 `(required)` 且致命、可选只警告。你的提案 2 和 3 已经在内：fallback 在 `assertEntriesActive` 之前完成；附带行要么恢复、要么带着自己的记录。

**此前仍缺的，以及我们改了什么。** 页面脚本传输在脚本 `error` 事件里丢弃了浏览器的 `ErrorEvent.message`，解析错误因此只报 `bundle script <url> failed to load`，真正的 `SyntaxError` 只留在控制台。我们的分支 `fix/client-bundle-error-text` 在浏览器报出消息时把它追加进文本：`client-modules: bundle script <url> failed to load: SyntaxError: Unexpected token ':'`。该文本经到达尝试链进入该行的导入错误记录与启动报告，致命错误或警告里就能看到肇事插件的真实语法错误。无消息的失败（网络类）保持原文本；重试一次、已执行批次不重放、逐行 fallback 全部未动。

**我们刻意没有做的。** 提案 1 的 runtime throw 一半：脚本解析成功、注册了部分行、然后抛错的情形，传输仍然 resolve（抛错以 window error 浮现），因为若当作传输失败处理，下一个导入者的重试会重新执行该批次，在首个重复注册处停住之前重放顶层代码——「已执行批次不重放」规则正是为了阻止这一点。对这类抛错，报告仍写 `loaded without registering …`，原文只在控制台。要让文本浮现，需要 `ScriptRealm.execute` 契约在每个载体上携带执行错误结果，这是留给维护者的接缝决定。

证据：`packages/client/modules` 全套 8 文件 / 271 用例通过，含两个新页面传输用例（消息进入拒绝文本与导入记录；无消息文本不变）；还原 master 传输后消息用例失败（负控），恢复修复后通过；启动审计 spec 14/14 通过；lint 与 typecheck 通过；无快照钉住旧文本。上游不接受外部 PR，分支暂存于我们的 fork、无 CI 结果。我们未复现你的 Windows/rc.1 环境；以上结论来自 master 源码与其测试。
