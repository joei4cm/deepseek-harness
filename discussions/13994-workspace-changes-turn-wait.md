<!--
Status: draft, not published.
Target: Discussion #13994.
The one-line takeover claim has been published; this draft needs the author's
authorization, and a fresh check for new comments, before anything else is posted.
-->

# Published claim (one line)

我们对照当前 `master`（`4b399c39a6`）接手了这个问题。

# English reply (draft)

Thanks for the measurements — the fake-model setup made it clear that the wait sits in the plugin, not in the model round.

We took this on against current `master` (`4b399c39a6`) and implemented both of your suggestions.

**The turn no longer waits for the snapshot.** The `agent/turn-stopping` listener used to await the whole end-of-turn snapshot, diff, and summary, and the loop writes `turn/end` only after that listener returns. It now queues the record and returns at once; the `workspace/changes` event is appended when the summary is ready, so it now arrives after `turn/end`. The snapshot is taken at the same moment as before, because the plugin's own queue decides that either way. The web client needed one matching adjustment: the turn-tail card used to read the turn's record data once at render time, which was fine when the announcement always preceded `turn/end`; it now subscribes to the turn's record store, so a card renders wherever in that order the announcement lands. One thing to be aware of: the work has not disappeared. If the next turn's first tool call starts before the previous record has finished, that call still waits for the rest, as it always did, so a snapshot never races a file edit.

**Snapshots reuse one index.** Each Session now keeps one snapshot index in its own temporary directory: the first snapshot seeds it from the repository's index, and later snapshots reuse it, so `git add` skips files whose stat data has not changed. On a 16-core Linux host with 10,000 committed files plus 300 untracked 100 KB files, later snapshots of an unchanged tree went from 141–185 ms to 33–46 ms; the first snapshot costs the same as before (about 1.1 s here), since every object still has to be written once. A failed `git add` or `write-tree` deletes the index and its lock, so the next snapshot starts over instead of failing on a stale lock. We also tried `core.untrackedCache`; it gave no measurable gain on top of the reused index, so we left it out.

Two edge cases change with the reused index: a file that becomes unreadable between two snapshots keeps its earlier content instead of showing up as deleted, and a file that was already snapshotted and is ignored afterwards stays in later snapshots.

We could not reproduce the 60k-file numbers here; if you can rerun your benchmark script against the branch, the first-turn and later-turn figures would be very useful.

The branch is `fix/workspace-changes-turn-tail-wait`; upstream does not accept external pull requests, so it sits on our fork: https://github.com/joei4cm/deepseek-harness/tree/fix/workspace-changes-turn-tail-wait

# 中文对照（仅供阅读，不发布）

感谢测量数据——用立即作答的假模型测，清楚地表明等待来自插件，而不是模型调用。

我们对照当前 `master`（`4b399c39a6`）接手了这个问题，两条建议都已实现。

**轮次不再等待快照。** 原先 `agent/turn-stopping` 的监听器要等轮末快照、diff 与摘要全部完成，而 loop 在这个监听器返回后才写 `turn/end`。现在它把记录排入队列后立即返回，摘要准备好后才追加 `workspace/changes`，所以这个事件现在落在 `turn/end` 之后。快照拍摄的时刻与原来相同，因为这一时刻由插件自己的队列决定。Web 客户端做了一处对应调整：轮尾卡片原先只在渲染时读一次轮次记录数据，这在宣告总是先于 `turn/end` 时没有问题；现在它订阅轮次的记录数据源，宣告无论先到还是后到，卡片都照常渲染。需要注意的是这部分工作并没有消失：如果下一轮的第一个工具调用在上一轮的记录完成之前开始，这个调用仍要等剩下的部分，和原来一样，以免快照与文件修改竞争。

**快照复用同一个 index。** 每个 Session 在自己的临时目录里保留一个快照 index：第一次快照从仓库的 index 复制，之后的快照复用它，`git add` 会跳过文件状态没有变化的文件。在 16 核 Linux 机器上，对 1 万个已提交文件加 300 个各 100 KB 的未跟踪文件，工作区不变时后续快照从 141–185 ms 降到 33–46 ms；第一次快照的开销不变（本机约 1.1 秒），因为每个对象仍需写入一次。`git add` 或 `write-tree` 失败时会删除这个 index 及其锁文件，下一次快照重新开始，不会因为残留的锁一直失败。我们也试了 `core.untrackedCache`，在复用 index 的基础上没有可测量的收益，所以没有采用。

复用 index 改变了两种边界情况：在两次快照之间变得不可读的文件保留之前的内容，而不是显示为删除；已被快照收录、之后才被忽略的文件仍留在后续快照中。

我们这边没能复现 6 万文件规模的数字；如果你能用自己的基准脚本对这个分支再跑一次，第一轮和后续轮次的数字会很有帮助。

分支为 `fix/workspace-changes-turn-tail-wait`；上游不接受外部 PR，所以它放在我们的 fork：https://github.com/joei4cm/deepseek-harness/tree/fix/workspace-changes-turn-tail-wait
