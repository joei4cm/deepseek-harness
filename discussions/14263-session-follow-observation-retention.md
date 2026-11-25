<!--
状态：草稿，未发布。
用途：Discussion #14263 的回复正文，供作者过目后决定是否发布。
目标渠道：上游仓库的 Discussions（上游 CONTRIBUTING 声明不接受外部 PR、Issues 已关闭，Discussions 是唯一被认可的反馈渠道）。
说明：本仓库是 fork，改动在分支 `fix/session-follow-observation-retention` 上，未向上游开 PR。
-->

# English reply (for posting to Discussion #14263)

Thank you for the measured breakdown — the `follow()` dominator chain is exact, and I could confirm it straight from the source.

**What I found on `master`**

`WebController.follow()` acquires the opening observation with `using observation`, builds the snapshot, and disposes it explicitly before `yield opening`. The disposal timing is correct, but the `using` resource record — which holds the object reference — stays on the generator's resource stack until the generator completes, and a `follow` generator completes only when the client closes the stream. So every open view of a long session pins the disposed observation and the whole event history behind it, exactly the 210 MB chain in your heap snapshot.

**Fix**

Your option 2, kept minimal: the opening snapshot is now built inside a helper whose `using` scope closes on return — one level above the first `yield`. The generator retains only the snapshot frame, the cursor, and the queued increments; the frame sequence, the first-frame content, the promotion timing, and the lease-release ordering are unchanged. I deliberately did not touch `SessionObservation`'s dispose semantics (your option 3), since the lease contract is fine — the leak was the generator's bookkeeping, not the observation's.

Regression test: `drops the opening Observation once the snapshot is delivered` — it spies the observation acquisition, takes a WeakRef, delivers the snapshot, forces full GC, and asserts the observation is collectable. It fails on current `master` (the reference survives) and passes with the change. One pitfall worth knowing if you extend it: a vitest spy's `mock.results` retains the settled promise — and with it the observation — so the test clears the spy journal before the GC passes.

Per-file coverage on the changed file stays at 100%.

**Scope note**

I left your items 2 and 3 (byte-bounded observation cache and cold-log memo, and windowed history for loaded sessions) alone — those are the larger memory-governance track of #13639 and deserve their own design, not a rider on this fix.

A branch with the change is on my fork (`fix/session-follow-observation-retention`, based on `dsh-v0.2.3-alpha.2`). I have not opened a pull request, since `CONTRIBUTING.md` states that external pull requests are not accepted — happy to hand over the branch, a patch, or a diff in whatever form is useful to you.

# 中文对照（仅供作者阅读，不发布）

感谢这份有实测数据的拆解——`follow()` 的支配链完全准确，我可以直接从源码证实。

**在 `master` 上的核对结果**

`WebController.follow()` 用 `using observation` 取得打开观测，构建快照，并在 `yield opening` 之前显式 dispose。释放时序是对的，但 `using` 的资源登记记录（持有对象引用）会一直留在生成器的资源栈上，直到生成器结束；而 `follow` 生成器只在客户端关闭流时才结束。于是每个打开着长会话的视图都把「已释放的 observation 连同其背后的整份事件历史」钉在堆里——正是你堆快照里那条 210 MB 的链。

**修复**

采用你的方案 2，保持最小：打开快照现在在首个 `yield` 之上一层的作用域里构建，该作用域随方法返回关闭。生成器只持有快照帧、游标与队列增量；帧序列、首帧内容、promote 时序与租约释放顺序都不变。我有意没有动 `SessionObservation` 的释放语义（你的方案 3）——租约契约本身没问题，漏的是生成器的记账，不是 observation 的。

回归测试：`drops the opening Observation once the snapshot is delivered`——对观测获取打 spy、取 WeakRef、交付快照、强制全量 GC，断言对象可回收。在当前 `master` 上失败（引用存活），随修复通过。一个值得知道的坑：vitest spy 的 `mock.results` 会持有已 settle 的 Promise（连带 observation），所以测试在 GC 前先清掉 spy 日志。

改动文件的逐行覆盖率保持 100%。

**范围说明**

你的第 2、3 项（观察缓存与 cold-log memo 按字节限容、已加载会话的窗口化历史）我没有动——那是 #13639 的更大内存治理主线，值得单独设计，不该搭这个修复的车。

改动在 fork 的分支 `fix/session-follow-observation-retention`（基于 `dsh-v0.2.3-alpha.2`）上。由于 `CONTRIBUTING.md` 声明不接受外部 PR，我没有开 PR——需要的话我可以以分支、patch 或 diff 的形式交付。
