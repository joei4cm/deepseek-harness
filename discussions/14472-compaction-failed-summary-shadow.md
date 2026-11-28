<!--
Status: draft, not published.
Target: Discussion #14472.
The one-line takeover claim has been published; this draft needs the author's
authorization, and a fresh check for new comments, before anything else is posted.
-->

# Published claim (one line)

我们对照当前 `master`（`4b399c39a6`）接手了这个问题。

# English reply (draft)

Thanks for the report — the per-frame evidence, the three `compaction/end` rows that each carry the rejected surface replacement, and the missing `compact-checkpoint` for exactly those three compaction ids are what make the failure chain readable.

We took this on against current `master` (`4b399c39a6`), and our reading matches the analysis in this thread: the two halves are separate.

**Write side.** `commitCompactionBody` writes `compaction/summary` and the checkpoint `user/message` that shadows it as two separate appends, so when the checkpoint is refused the summary stays in the log. A summary names the span its checkpoint shadows, so that row then claims a shadow the session never performed. We admit the two rows as one group instead — the documented array form of `Session.append`, which validates every candidate before it changes the log — so a refused checkpoint leaves neither row. The tool-result pruner had the same two-append shape for `compaction/prune` and its replacement, and now admits them as one group too.

**Read side.** The relationship check applies the surface-span rule to every `compaction/summary`, including one whose run never completed. Such a summary describes a shadow that never happened, so its span need not name current surface nodes; we exempt it from the span rule when the compaction never completed successfully. A completed compaction keeps the strict rule, and logs that already carry such a row — the sessions in this report included — open again.

One part of the report we did not take: the range selection half. Current `master` refuses a range that starts at the protected head (`validateSurfaceRegion`), so the summary in the report's log predates that guard; the question raised in this thread about how selection and the commit-time guard could disagree on the same session is still open, and we did not settle it.

Our branch is `fix/compaction-failed-summary-shadow`, written from this report and from the analysis in this thread; upstream does not accept external pull requests, so the branch sits on our fork: https://github.com/joei4cm/deepseek-harness/tree/fix/compaction-failed-summary-shadow

# 中文对照（仅供阅读，不发布）

感谢这份报告——按帧切出的证据、三条各自记录了被拒 surface 替换的 `compaction/end`，以及恰好缺少对应 `compact-checkpoint` 的那三个 compaction id，把失败链讲清楚了。

我们对照当前 `master`（`4b399c39a6`）接手了这个问题，读法与本帖中的分析一致：两侧是分开的两件事。

**写入侧。** `commitCompactionBody` 把 `compaction/summary` 与遮蔽它的 checkpoint `user/message` 分两次追加，因此 checkpoint 被拒时 summary 留在日志里。summary 声明的正是它的 checkpoint 所遮蔽的区间，于是那一行声称了一次从未发生的遮蔽。我们改为把两行作为一组提交——用 `Session.append` 已文档化的数组形式，它在改动日志之前先校验全部候选——checkpoint 被拒时两行都不落盘。工具结果剪枝的 `compaction/prune` 与其替换此前也是两次追加，现在同样作为一组提交。

**读取侧。** 关系校验对每一条 `compaction/summary` 都套用 surface 区间规则，包括运行从未完成的那一条。这类 summary 描述的是一次没有发生的遮蔽，其区间本就不必指向当前 surface 节点；当压缩没有成功完成时，我们豁免它的区间规则。成功完成的压缩仍按严格规则校验，已经写入这类行的日志——本帖报告的那些会话也在其中——可以再次打开。

报告里我们没有接手的那一半：选区选择。当前 `master` 已经拒绝以受保护 head 起始的范围（`validateSurfaceRegion`），所以报告日志里的 summary 早于那道守卫；本帖提出的「选择与提交时的守卫如何在同一个 Session 上得出不同结论」这一问题仍然开放，我们没有定论。

我们的分支是 `fix/compaction-failed-summary-shadow`，依据本报告与本帖中的分析写成；上游不接受外部 PR，因此该分支暂存在 fork 上：https://github.com/joei4cm/deepseek-harness/tree/fix/compaction-failed-summary-shadow
