<!--
状态：草稿，未发布。
用途：Discussion #14429 的回复正文，供作者过目后决定是否发布。本稿确认报告、逐条对照当前 master 与其三条提案，并说明我们暂存分支的修复（含 runtime throw）。
核对基线：上游 master（4b399c39a6）；我们的分支 fix/client-bundle-error-text @ e9dab584c2。
注意：接手声明（claim）尚未发布，需作者明确授权后才能发帖；本稿发布前需重查讨论区有无新评论。
-->

# English reply (for posting to Discussion #14429)

Your reading of `main` is correct, and we confirmed the rest against master (`4b399c39a6`): the structural half of the rc.1 failure is already fixed there, and the remaining half is the message quality you named in proposal 1.

**What master already does.** When a shared batch script dies, the rows it never registered fall back to their own one-resource URLs inside the same import (`system.ts` `arrive`), so an innocent entry activates and never reaches the audit — the rc.1 "innocent named, culprit invisible" report can no longer be produced. The row whose own code is broken fails its own import, and `recordingImportError` keys the failure under its own id, so the audit names the culprit, marks `(required)` failures as fatal, and only warns for optional ones. Your proposals 2 and 3 are therefore already in.

**What was still missing.** In Chromium, a classic `<script src>` that fails to parse or throws while executing still fires `load` on the element; the error arrives only as a `window` `ErrorEvent` whose `filename` is the script URL. The page transport listened only to the element, so it resolved and the report said `loaded without registering "<id>"`, with the real `SyntaxError` left in the console.

**What we changed.** Our branch `fix/client-bundle-error-text` makes the default page transport collect `window` error events for its own script URL while the element is attached, and reject with a `ScriptExecutionError` on `load`: `client-modules: bundle script <url> raised an execution error: Uncaught SyntaxError: Unexpected token ':'`. The module system treats that rejection as an executed script, not a transport failure: the batch is never retried or replayed (a replay would stop at the first duplicate registration), rows it registered before the error stay usable, and each missing row falls back to its one-resource URL exactly as before. The text reaches the row's recorded import error and the boot report. This covers runtime throws as well as parse errors, without changing the `ScriptRealm.execute` contract; a carrier that supplies its own `loadBundle` (the WebWorker preview) is unaffected.

Evidence: the `packages/client/modules` suite passes 8 files / 274 tests with 100% coverage of the two changed files; with master's two source files restored the new execution-error cases fail (negative control); in headless Chromium the branch's transport reports `Uncaught SyntaxError: Unexpected token ';'` for a malformed script, `Uncaught TypeError: boom` for a throwing one, resolves a valid one, and keeps `failed to load` for a 404; the boot audit spec passes 14/14; lint and typecheck pass. Upstream declines external pull requests, so the branch is staged on our fork with no CI result. We have not reproduced your Windows/rc.1 environment or run the full browser replay suite.

# 中文对照（仅供作者阅读，不发布）

你对 `main` 的解读是正确的，我们又在 master（`4b399c39a6`）上核对了其余部分：rc.1 故障的结构性一半在那里已经修复，剩下的一半是你提案 1 点到的消息质量。

**master 已经做到的。** 共享批脚本死亡后，未被注册的行会在同一次导入里落到各自的单资源 URL（`system.ts` 的 `arrive`），无辜条目因此恢复激活、不会进审计——rc.1 那种「无辜插件被点名、真凶不可见」的报告在 master 上无法再产生。自身代码损坏的行让自己那次导入失败，`recordingImportError` 把失败记在它自己的 id 下，审计因此指向肇事行，必选失败标 `(required)` 且致命、可选只警告。你的提案 2 和 3 已经在内。

**此前仍缺的。** 在 Chromium 中，经典 `<script src>` 解析失败或执行时抛出，元素仍触发 `load`；错误只以 `window` 上的 `ErrorEvent` 到达，其 `filename` 是脚本 URL。页面传输只监听元素，因此 resolve，报告写的是 `loaded without registering "<id>"`，真正的 `SyntaxError` 只留在控制台。

**我们改了什么。** 分支 `fix/client-bundle-error-text` 让默认页面传输在元素挂载期间收集 `filename` 等于本脚本 URL 的 `window` 错误，并在 `load` 时以 `ScriptExecutionError` 拒绝：`client-modules: bundle script <url> raised an execution error: Uncaught SyntaxError: Unexpected token ':'`。模块系统把该拒绝当作「脚本已执行」而非传输失败：批次绝不重试或重放（重放会在首个重复注册处停住），出错前已注册的行保持可用，每条缺失行照旧落到自己的单资源 URL。该文本进入该行的导入错误记录与启动报告。这同时覆盖 runtime throw 与解析错误，且不改 `ScriptRealm.execute` 契约；自带 `loadBundle` 的载体（WebWorker 预览）不受影响。

证据：`packages/client/modules` 全套 8 文件 / 274 用例通过，两个改动文件覆盖率 100%；把两个源文件还原为 master 版本后新增的执行错误用例失败（负控）；无头 Chromium 中本分支的传输对畸形脚本报 `Uncaught SyntaxError: Unexpected token ';'`、对抛错脚本报 `Uncaught TypeError: boom`、正常脚本 resolve、404 仍报 `failed to load`；启动审计 spec 14/14 通过；lint 与 typecheck 通过。上游不接受外部 PR，分支暂存于我们的 fork、无 CI 结果。我们未复现你的 Windows/rc.1 环境，也未跑完整浏览器回放套件。
