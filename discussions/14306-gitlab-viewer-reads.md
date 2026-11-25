<!--
状态：草稿，未发布。
用途：Discussion #14306 的回复正文，供作者过目后决定是否发布。
说明：核对本地源码的可选能力；未审查贡献者的改动，也未独立验证 GitLab API 限制。
-->

# English reply (for posting to Discussion #14306)

The current tree supports the integration point you describe: `viewerSources()` includes a provider only when it declares `viewer` and implements both `listForViewer` and `countForViewer`; `readDescription` is also optional and returns `unsupported` when absent. The GitLab provider in this checkout implements neither capability. I have not reviewed or run your fork.

The limitations you list deserve particular attention in review. In particular, the author/assignee/reviewer union you describe for `involved` is not the same definition as GitHub's filtered `involves:@me` set. Documenting the approximation, pagination and count behavior, and how absent pipeline or review fields appear would help consumers understand what the page can and cannot report. I have not independently verified the stated GitLab API limitations.

Your public commit and Discussion provide a reviewable handover. The real-host results are useful; the typecheck and relevant automated tests still need to run against the proposed changes. Acceptance remains a maintainer decision.

# 中文对照（仅供作者阅读，不发布）

当前源码支持你描述的接入点：`viewerSources()` 仅在 provider 声明 `viewer` 且实现 `listForViewer` 和 `countForViewer` 时列出它；`readDescription` 也是可选方法，未实现时返回 `unsupported`。本地检出的 GitLab provider 尚未实现这两项能力。我没有审查或运行你的 fork。

你列出的限制值得重点评审。尤其是 `involved` 的作者、指派人和评审人并集，与 GitHub 排除另外两类后的 `involves:@me` 定义不同。建议说明这种近似、分页和计数行为，以及 pipeline 或 review 字段缺失时页面显示什么，方便使用方理解能力范围。我尚未独立核实所述 GitLab API 限制。

公开提交和 Discussion 已经提供了可供评审的交接材料；真实主机的结果也有参考价值。针对提议改动的类型检查和相关自动测试仍需运行，是否接受由维护者决定。
