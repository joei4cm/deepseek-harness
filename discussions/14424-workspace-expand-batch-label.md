<!--
状态：草稿，未发布。
用途：Discussion #14424 的回复正文，供作者过目后决定是否发布。本稿报告我们选了方案 2 及原因（步进是文档化契约），说明批数语义与中文文案修正，并把方案 1 留给维护者裁决。
核对基线：上游 master（4b399c39a6）；我们的分支 fix/workspace-session-expand-label。
-->

# English reply (for posting to Discussion #14424)

Your line numbers match master exactly, and we confirmed the mismatch. One piece of evidence decides which side is wrong, though: the five-at-a-time stepping is the documented contract, not an accident. Both `ui-workspace` READMEs state it — "Each **Show more** click raises it by five, without the 50-row limit, and reveals the rest when five or fewer remain" — and the `expands 17 ordinary sessions five at a time and resets after the final partial batch` spec pins the stepping step by step. The component also bounds bulk expansion deliberately elsewhere: automatic watermark raising stops at the first 50 rows (`SESSION_WATERMARK_AUTO_MAX`). The label is the side that lies.

**What we changed.** Our branch `fix/workspace-session-expand-label` takes your option 2, with one twist: instead of a fixed "5 more", the button now names the exact batch the click reveals — `Math.min(visible.hiddenCount, SESSION_WATERMARK_BASE)`. So twelve hidden reads "再展开 5 个会话" (and reveals exactly five), two hidden reads "再展开 2 个会话" (and reveals all two), which keeps the ≤5 jump honest the same way the old label was. The click behavior, the watermark semantics, the 50-row bound, and the collapse reset are untouched.

**The Chinese copy.** With batch counts, the zh template 「展开其余 {n} 个会话」 still over-promises — 其余 says "the remaining", so "其余 5 个" reads as the remaining total when twenty remain. We changed it to 「再展开 {n} 个会话」. The other seven locales already say "show {n} more", so only zh moved. Both READMEs now name the batch the next click reveals.

**What we did not take.** Option 1 (one click expands all) contradicts the documented contract and the pinned test, so it is a product decision rather than a bug fix; if maintainers prefer it, the click is a one-line change and the label can keep the total. We left it to them.

**One test ripple worth knowing.** With batch counts, two collapsed Workspaces now render identical button labels, so the one spec that told them apart by name ("keeps each Workspace batch limit independent") now locates each button inside its own section. The behavior it asserts is unchanged.

Evidence: the updated spec passes 124/124, and with master's sources restored the 14 label assertions fail (negative control); `pnpm run test:gui` passes 834 files / 14 763 tests; `DSH_SNAPSHOT=replay pnpm run test:web` did not complete locally: the first attempt's serial replay lane ran about 90 minutes past the frontend rebuild without reaching its last file (well beyond the CI job's 60-minute budget) and was stopped without a verdict; a second `test:web:built` attempt reusing the build was killed at session end before printing its summary, and every failure it had reported belonged to unrelated specs (WebKit cases and ENOSPC file-watcher exhaustion), none to the label; the lane remains to be verified in CI or another environment, and no PR or CI result exists yet; the rebuild and browser-smoke phase itself exited without errors. No GIF: upstream declines external pull requests, the branch is staged on our fork, and there is no PR body to attach one to; the client spec checks the Chinese wording, and both focused Chromium scenarios now pass with updated sidebar ARIA expectations. We inspected screenshots from an isolated Web scenario: the English page shows “Show 5 more sessions”, while the Chinese page shows “再展开 5 个会话” followed by “再展开 2 个会话” after clicking.

# 中文对照（仅供作者阅读，不发布）

你的行号与 master 完全一致，不一致也确认了。但有一条证据能裁定哪一侧错了：五条步进是文档化契约，不是偶然。`ui-workspace` 两份 README 都写明了它——「每次点击升高五条，不受 50 行限制；剩余五条或更少时显示全部」——而且 `expands 17 ordinary sessions five at a time and resets after the final partial batch` 这条用例逐步钉住了步进。组件在别处也刻意限制批量展开：自动水位线抬升只覆盖前 50 行（`SESSION_WATERMARK_AUTO_MAX`）。撒谎的是标签这一侧。

**我们改了什么。** 我们的分支 `fix/workspace-session-expand-label` 采用你的方案 2，带一处调整：按钮不再写固定的「5 个」，而是写出本次点击实际揭示的批数——`Math.min(visible.hiddenCount, SESSION_WATERMARK_BASE)`。于是隐藏十二条时读作「再展开 5 个会话」（点击恰好揭示五条），隐藏两条时读作「再展开 2 个会话」（一次显示全部两条），≤5 时的诚实性与旧标签一致。点击行为、水位线语义、50 行上限与收起重置全部未动。

**中文文案。** 批数语义下，中文模板「展开其余 {n} 个会话」仍然过度承诺——「其余」说的是剩余全体，剩余二十条时「其余 5 个」会读成剩余总数。我们把它改为「再展开 {n} 个会话」。其余七种语言本来就写「show {n} more」，只有中文移动了。两份 README 现已说明按钮计数表示下一次点击将显示的批数。

**我们没有采用的。** 方案 1（一次展开全部）与文档化契约和被钉住的用例相矛盾，属于产品决定而非缺陷修复；若维护者倾向它，点击处理是一行改动，标签可以保留总数。我们把它留给维护者。

**一条值得知道的影响。** 批数语义下，两个同时折叠的 Workspace 会渲染出相同的按钮文案，因此原来靠名称区分两颗按钮的那条用例（"keeps each Workspace batch limit independent"）改为在各自分节内定位；它断言的行为不变。

证据：更新后的 spec 124/124 通过；还原 master 源码后 14 条标签断言失败（负控）；`pnpm run test:gui` 834 文件 / 14 763 用例通过；`DSH_SNAPSHOT=replay pnpm run test:web` 本地两次均未完成：首次在前端重建后串行重放约 90 分钟仍未到文件末尾（远超 CI 60 分钟作业预算），按决策点停止、未得出结论；第二次以 `test:web:built` 复用既有构建运行至会话终止、无最终汇总，已打印的失败均属无关规格（WebKit 用例与 ENOSPC 文件监视器耗尽等本机环境问题），无标签相关失败。该道仍待后续 CI 或其他环境验证，目前没有 PR 或 CI 结果；重建与浏览器冒烟阶段本身无报错。无 GIF：上游不接受外部 PR，分支暂存于我们的 fork，没有可附着的 PR 正文；中文文案由组件测试逐字断言；更新侧栏 ARIA 预期后，两项 Chromium 用例均通过。我们查看了隔离 Web 场景的页面截图：英文侧栏显示 “Show 5 more sessions”；中文侧栏显示「再展开 5 个会话」，点击后显示「再展开 2 个会话」。
