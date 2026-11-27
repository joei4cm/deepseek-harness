<!--
状态：草稿，未发布。
用途：Discussion #14424 的回复正文，供作者过目后决定是否发布。本稿报告我们选了方案 2 及原因（步进是文档化契约），说明批数语义与中文文案修正，并把方案 1 留给维护者裁决。
核对基线：上游 master（4b399c39a6）；我们的分支 fix/workspace-session-expand-label。
-->

# English reply (for posting to Discussion #14424)

Your line numbers match master exactly, and we confirmed the mismatch. One piece of evidence decides which side is wrong, though: the five-at-a-time stepping is the documented contract, not an accident. Both `ui-workspace` READMEs state it — "Each **Show more** click raises it by five, without the 50-row limit, and reveals the rest when five or fewer remain" — and the `expands 17 ordinary sessions five at a time and resets after the final partial batch` spec pins the stepping step by step. The component also bounds bulk expansion deliberately elsewhere: automatic watermark raising stops at the first 50 rows (`SESSION_WATERMARK_AUTO_MAX`). The label is the side that lies.

**What we changed.** Our branch `fix/workspace-session-expand-label` takes your option 2, with one twist: instead of a fixed "5 more", the button now names the exact batch the click reveals — `Math.min(visible.hiddenCount, SESSION_WATERMARK_BASE)`. So twelve hidden reads "再展开 5 个会话" (and reveals exactly five), two hidden reads "再展开 2 个会话" (and reveals all two), which keeps the ≤5 jump honest the same way the old label was. The click behavior, the watermark semantics, the 50-row bound, and the collapse reset are untouched.

**The Chinese copy.** With batch counts, the zh template 「展开其余 {n} 个会话」 still over-promises — 其余 says "the remaining", so "其余 5 个" reads as the remaining total when twenty remain. We changed it to 「再展开 {n} 个会话」. The other seven locales already say "show {n} more", so only zh moved. Both README references to the button name moved with it.

**What we did not take.** Option 1 (one click expands all) contradicts the documented contract and the pinned test, so it is a product decision rather than a bug fix; if maintainers prefer it, the click is a one-line change and the label can keep the total. We left it to them.

**One test ripple worth knowing.** With batch counts, two collapsed Workspaces now render identical button labels, so the one spec that told them apart by name ("keeps each Workspace batch limit independent") now locates each button inside its own section. The behavior it asserts is unchanged.

Evidence: the updated spec passes 124/124, and with master's sources restored the 14 label assertions fail (negative control); `pnpm run test:gui` passes 834 files / 14 763 tests; `DSH_SNAPSHOT=replay pnpm run test:web` did not complete locally: after the frontend rebuild, the serial replay lane ran for about 90 minutes without reaching its last file (well past the CI job's own 60-minute budget), so we stopped it without a verdict; it remains to be verified in CI or another environment, and no PR or CI result exists yet; the rebuild and browser-smoke phase itself exited without errors. No GIF: upstream declines external pull requests, the branch is staged on our fork, and there is no PR body to attach one to; the client spec checks the Chinese wording, and both focused Chromium scenarios now pass with updated sidebar ARIA expectations. We inspected the English page screenshot and confirmed it shows “Show 5 more sessions”; the Chinese page was not visually inspected.

# 中文对照（仅供作者阅读，不发布）

你的行号与 master 完全一致，不一致也确认了。但有一条证据能裁定哪一侧错了：五条步进是文档化契约，不是偶然。`ui-workspace` 两份 README 都写明了它——「每次点击升高五条，不受 50 行限制；剩余五条或更少时显示全部」——而且 `expands 17 ordinary sessions five at a time and resets after the final partial batch` 这条用例逐步钉住了步进。组件在别处也刻意限制批量展开：自动水位线抬升只覆盖前 50 行（`SESSION_WATERMARK_AUTO_MAX`）。撒谎的是标签这一侧。

**我们改了什么。** 我们的分支 `fix/workspace-session-expand-label` 采用你的方案 2，带一处调整：按钮不再写固定的「5 个」，而是写出本次点击实际揭示的批数——`Math.min(visible.hiddenCount, SESSION_WATERMARK_BASE)`。于是隐藏十二条时读作「再展开 5 个会话」（点击恰好揭示五条），隐藏两条时读作「再展开 2 个会话」（一次显示全部两条），≤5 时的诚实性与旧标签一致。点击行为、水位线语义、50 行上限与收起重置全部未动。

**中文文案。** 批数语义下，中文模板「展开其余 {n} 个会话」仍然过度承诺——「其余」说的是剩余全体，剩余二十条时「其余 5 个」会读成剩余总数。我们把它改为「再展开 {n} 个会话」。其余七种语言本来就写「show {n} more」，只有中文移动了。README 中两处按钮名引用也随之更新。

**我们没有采用的。** 方案 1（一次展开全部）与文档化契约和被钉住的用例相矛盾，属于产品决定而非缺陷修复；若维护者倾向它，点击处理是一行改动，标签可以保留总数。我们把它留给维护者。

**一条值得知道的影响。** 批数语义下，两个同时折叠的 Workspace 会渲染出相同的按钮文案，因此原来靠名称区分两颗按钮的那条用例（"keeps each Workspace batch limit independent"）改为在各自分节内定位；它断言的行为不变。

证据：更新后的 spec 124/124 通过；还原 master 源码后 14 条标签断言失败（负控）；`pnpm run test:gui` 834 文件 / 14 763 用例通过；`DSH_SNAPSHOT=replay pnpm run test:web` 本地未完成：前端重建后，串行重放道在本机持续运行约 90 分钟仍未到文件末尾（远超 CI 60 分钟作业预算），我们按决策点停止、未得出通过或失败的结论，该道仍待后续 CI 或其他环境验证，目前没有 PR 或 CI 结果；重建与浏览器冒烟阶段本身无报错。无 GIF：上游不接受外部 PR，分支暂存于我们的 fork，没有可附着的 PR 正文；中文文案由组件测试逐字断言；更新侧栏 ARIA 预期后，两项 Chromium 用例均通过。我们查看了英文页面截图，确认侧栏显示 “Show 5 more sessions”；未目视检查中文页面。
