<!--
状态：草稿，未发布。
用途：Discussion #14276 的回复正文，供作者过目后决定是否发布。
目标渠道：上游仓库的 Discussions（上游 CONTRIBUTING 声明不接受外部 PR、Issues 已关闭，Discussions 是唯一被认可的反馈渠道）。
说明：本仓库是 fork；提案 1 已在分支 fix/bash-output-head-tail-preview 上实现，未向上游开 PR；提案 2（嵌套双重 spill 去重）为分析，未附改动。
-->

# English reply (for posting to Discussion #14276)

Both observations check out from the source, and I have implemented the first proposal on a fork branch.

**What the code does today**

The subprocess layer's `OutputCollector` keeps an in-memory tail and writes the full stream to a spill file on overflow — the inline comment records the rationale ("Tail-keep rationale (pi/OpenCode): errors and final results cluster at the end of command output; the spill file covers the head"). The bash preview is exactly that tail, so headers, snapshot ids, and first-failure root causes are clipped, which matches your `LINE=008917` observation. The nested double spill is also real: the outer spill policy wraps the already-truncated text again, so following the outer path yields only the inner slice.

**Proposal 1, implemented (`fix/bash-output-head-tail-preview`, based on `dsh-v0.2.3-alpha.2`)**

A truncated stdout preview now keeps the stream's head alongside the tail: the head bytes are read back from the complete spill file (bounded synchronous read), followed by one exact omission marker (`[… omitted N bytes …]`, `N` exact), followed by the in-memory tail re-trimmed to the budget minus the head. Two rules came out of testing rather than taste:

- The head window takes at most **half** the per-call stdout budget. My first cut let the head take the whole budget minus one byte, and an existing test that pins "the last line stays visible in the preview" failed — errors and final results cluster at the end, so the tail must keep its share.
- The composition lives in the executors (`dsh-bash-local` / `dsh-pwsh-local`), and the subprocess layer is untouched. I first tried moving a head window into the collector itself; that steals bytes from the tail window whenever the stream fits the cap, and the background consumers' incremental reads (offset-based deltas) returned gaps. The tail window is load-bearing for those readers, so the collector now stays exactly as it was and the executors compose the preview at result time.

Degradation paths stay tail-only: a discarded spill, a spill directory removed by a cleaner, or a spill file deleted between spawn and result assembly all fall back to the current shape (covered by deterministic tests, including one that deletes the spill file mid-run). stderr remains tail-only, and a new `headBytes` config (default 2048, 0 restores tail-only) controls the window. The tool descriptions were updated to match, and the recorded-session snapshots were refreshed (pure description-replacement diffs, replay-verified).

**Proposal 2 (nested double spill), analysis only**

With head+tail previews the outer spill still triggers, but its file now contains the head+tail preview plus the inner pointer, which is strictly more useful than the old tail slice. The structural fix — recognizing that a result already names an authoritative full-output file and surfacing that path instead of re-spilling — is a generic-policy design question: the spill policy serves every tool, and "this text carries a pointer to the authoritative file" is a tool-side convention. A seam for tools to declare their authoritative recovery path (so the policy can reference it instead of duplicating it) would solve this without teaching the policy about bash; that is worth its own design discussion rather than a rider on the truncation change. The subprocess spill path is already in the preview's tail, so the model's recovery route is intact either way.

I cannot run your TraceTrial-Bench A/B myself, but if you do once an RC is available I would be glad to read the numbers. The branch is on my fork; I have not opened a pull request, since `CONTRIBUTING.md` states that external pull requests are not accepted — happy to hand over the branch, a patch, or a diff in whatever form is useful.

# 中文对照（仅供作者阅读，不发布）

两项观察都能从源码证实，第 1 项提案我已在 fork 分支上实现。

**今天的代码行为**

subprocess 层的 `OutputCollector` 内存只保留尾部，溢出时把完整流写入 spill 文件——行内注释记载了这一取舍（"Tail-keep rationale (pi/OpenCode): errors and final results cluster at the end of command output; the spill file covers the head"）。bash 预览就是这个尾部，所以表头、快照 id、首批失败根因全被裁掉，与你的 `LINE=008917` 观察一致。嵌套双重 spill 也属实：外层 spill 策略把已截断的文本再包一层，走外层路径只能拿到内层切片。

**提案 1，已实现（`fix/bash-output-head-tail-preview`，基于 `dsh-v0.2.3-alpha.2`）**

截断的 stdout 预览现在同时保留流的开头与结尾：头部字节从完整 spill 文件读回（一次有界同步读），随后是一条精确省略标记（`[… omitted N bytes …]`，N 精确），再接按「预算减头」重裁的内存尾部。两条规则来自测试而非偏好：

- 头部窗口最多占该次 stdout 预算的**一半**。我的第一版让头部拿走预算减一字节，结果一个钉住「末行必须留在预览内」的既有测试红了——错误与最终结果聚集在末尾，尾部必须保住自己的份额。
- 组合逻辑放在执行器（`dsh-bash-local` / `dsh-pwsh-local`），subprocess 层零改动。我最初把 head 窗口放进收集器本身；只要流没超上限，它就会把字节从尾部窗口偷走，后台消费者的增量读（按偏移的 delta）出现缺口。尾部窗口对那些读取者是承重的，所以收集器保持原样，执行器在结果组装时组合预览。

降级路径保持 tail-only：spill 被丢弃、spill 目录被清理器移除、spill 文件在 spawn 与结果组装之间被删，都回到现状形态（有确定性测试覆盖，包括一个运行中途删除 spill 文件的用例）。stderr 恒为 tail-only；新增 `headBytes` 配置（默认 2048，0 恢复 tail-only）控制窗口。工具描述已同步更新，录制会话快照已刷新（纯描述句替换 diff，复放验证通过）。

**提案 2（嵌套双重 spill），仅分析**

head+tail 预览下外层 spill 仍会触发，但其文件现在含 head+tail 预览加内层指针，严格优于旧的尾部切片。结构性修法——识别「结果已指名权威完整输出文件」并直接呈现该路径而不重复落盘——是通用策略层的设计问题：spill 策略服务所有工具，而「这段文本携带权威文件的指针」是工具侧约定。给工具一个声明权威恢复路径的接缝（策略据此引用而非复制）才能不教策略认识 bash；这值得单独的设计讨论，不该搭截断变更的车。subprocess spill 路径本来就在预览尾部，模型的恢复路线无论如何都是通的。

TraceTrial-Bench 的 A/B 我自己跑不了；等 RC 出来你们跑的话，我很乐意看数据。分支在我的 fork 上；由于 `CONTRIBUTING.md` 声明不接受外部 PR，我没有开 PR——需要的话可以以分支、patch 或 diff 的形式交付。
