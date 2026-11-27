## Motivation

侧栏分组视图的「展开其余 N 个会话」按钮文案承诺剩余**总数**，点击却每次只展开 **5** 条（`WorkspaceBrowser.tsx` 的点击处理按 `watermark + SESSION_WATERMARK_BASE` 步进，标签却传入 `visible.hiddenCount` 总数）；隐藏 25 条的分组要点 5 次，文案与行为不一致（Discussion #14424）。

定位时确认：五条步进是文档化契约而非缺陷——`ui-workspace` 两份 README 都写明「每次点击升高五条，不受 50 行限制；剩余五条或更少时显示全部」，`workspace-browser.client.spec.tsx` 的「five at a time」用例也钉住该步进。不一致来自标签一侧：它把剩余总数当作承诺写进按钮，而不是本次点击将揭示的批数。

## Changes

**Interface changes**: None。

**Behavior changes**:

- 展开按钮的计数改为本次点击实际揭示的批数 `Math.min(visible.hiddenCount, SESSION_WATERMARK_BASE)`：剩余多于五条时按钮显示「再展开 5 个会话」，剩余五条或更少时显示确切剩余数（该次点击一次显示全部）。点击行为、水位线语义、50 行自动上限与「收起」重置全部不变。
- 中文文案「展开其余 {n} 个会话」改为「再展开 {n} 个会话」：批数语义下「其余 5 个」在剩余更多时仍会读成剩余总数；其余七种语言的模板（Show {n} more sessions 等）本就表达「再多显示 {n} 个」，无需改动。
- README 双语同步：中文版两处按钮名引用（水位线段与动画段）改为**再展开**；英文版按钮文案未变，不改动。

**GUI demonstration**: 未嵌入 GIF：上游不接受外部 PR，本描述仅暂存于 fork。英文侧栏在真实 Web 页面截图中显示 “Show 5 more sessions”，浏览器测试及三份侧栏 ARIA 预期覆盖该标签；中文文案由组件测试逐字断言。

**Translation disclosure**: 中文「其余 → 再」是让文案与步进语义一致的翻译正确性修正，按惯例声明：文案正确性属于人工翻译评审项，词典键集完备性由 `satisfies Record<keyof typeof en, string>` 编译期保证。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**（行为矩阵——文案变更）：

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 隐藏 12 条时的按钮文案 | 「展开其余 12 个会话」（承诺总数，点击只揭示 5 条） | 「再展开 5 个会话」（承诺批数，点击揭示 5 条） | 「five at a time」用例的 labels 内联快照与循环断言 |
| 隐藏 7 条时的按钮文案 | 「展开其余 7 个会话」 | 「再展开 5 个会话」 | 同用例第二轮 |
| 隐藏 2 条（≤5）时的按钮文案 | 「展开其余 2 个会话」（点击一次显示全部） | 「再展开 2 个会话」（n 仍为确切剩余数，行为不变） | 同用例最后一步 |
| 隐藏 ≤5 各数值（1/2/3/4/5） | 文案为确切剩余数 | 不变（批数与剩余数相同） | 既有用例 |
| 双工作区同时折叠（两按钮标签同值） | 标签不同（12/6），可按名称区分 | 同名，按所在分节定位 | 「keeps each Workspace batch limit independent」改用 `within(section)` 定位 |
| 步进行为、≤5 一次显示全部、收起重置、50 行自动上限 | 不变 | 不变 | 既有用例 |

**Existing test behavior**: 按钮现在显示单次点击展开的数量，所以组件测试和浏览器测试的按钮名断言及三份侧栏 ARIA 预期随之更新。两个工作区按钮同名时，组件测试按分节定位。展开行数与收起行为的断言保持不变。

**Test entries**:

- 本机 `pnpm exec vitest run packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx --maxWorkers=2`：124/124 通过。
- 负控：把 `WorkspaceBrowser.tsx` 与 `locales.ts` 还原为 `origin/master` 后 14 条用例失败（全部是标签断言），恢复后全部通过。
- 本机 `pnpm run test:gui`：834 文件 / 14763 用例通过（2 跳过）。
- 本机 `DSH_SNAPSHOT=replay pnpm run test:web`：未完成——前端重建完成后，串行重放道在本机持续运行约 90 分钟仍未到文件末尾（远超 CI 60 分钟作业预算），按决策点停止，未得出通过或失败的结论；该道仍待后续 CI 或其他环境验证，目前没有 PR 或 CI 结果。前端构建与浏览器冒烟阶段本身无报错退出。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run typecheck`：5 项门禁通过；`pnpm run build:check` 通过。
- 本机 `pnpm run doc-sync`：41 项通过，2 项因上游已有问题失败：工具目录缺少 `tool-working-directory`，旧升级指南引用已删除的 `ptc-runtime-python` 包。
- 本机 `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/workspace-new-session-folding.e2e.ts --maxWorkers=2`：旧标签定位 2/2 超时；更新标签断言和三份 ARIA 预期后 2/2 通过。已查看使用隔离测试数据的实际英文页面截图，侧栏显示 “Show 5 more sessions”。
- 本机临时 Chromium 场景：在隔离 Web 测试环境中加载 12 条会话并查看中文截图，依次显示「再展开 5 个会话」和「再展开 2 个会话」，点击后出现「收起」；初次尝试在设置更新时超时，移除该设置操作并通过浏览器语言选择中文后通过。
- 本机 `pnpm run verify-translation-pairing --write packages/client/ui-workspace/README.md`：配对已重新记录。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复核上游 Discussion #14424 的定位，追出两份 README 与既有「five at a time」用例，判定步进是文档化契约、标签是缺陷侧，并完成三路查重。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 在报告者两个方案中选择方案 2（标签对齐步进）并落地为「批数计数 + 中文文案修正」，保持点击行为与文档契约不变。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 更新标签断言与快照、为同名按钮改分节定位，跑负控、test:gui、test:web 重放与配对检查。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写组件、语言字典与双语 README 改动。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
