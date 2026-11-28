<!--
Status: draft, not published.
Target: Discussion #14320.
The one-line takeover claim has been published; this draft needs the author's
authorization, and a fresh check for new comments, before anything else is posted.
-->

# Published claim (one line)

我们对照当前 `master`（`4b399c39a6`）接手了这个问题。

# English reply (draft)

Thanks for the profile and the prototype — the heap attribution to `consumeEventLine` under `readStoredLog`, and the patch with its correctness matrix, made this a direct port rather than an investigation.

We took this on against current `master` (`4b399c39a6`) and followed your design closely: the backend keeps the open `SessionLogScanner` of recently read current-version logs together with the bytes it has consumed, and a read of a log that only grew decodes just the appended frames (or raw lines) and continues the same scanner. The limits are yours too — eight logs and 250,000 retained events in total, evicting the least recently read — kept as internal constants beside `COLD_LOG_MEMO_MAX_ENTRIES`.

**What a continued read checks.** Same path, same device and inode, a larger size, the last 64 consumed bytes unchanged, no torn frame or line at the new end, and the scanner reporting every input byte committed. Anything else — and any failure while continuing — falls back to the existing full decode, so error classification stays where it was. Each read claims the retained scanner before decoding, so a concurrent read of the same Session simply decodes in full instead of sharing a half-advanced decoder; cancellation still propagates.

**What still runs on every read.** The whole-log relationship check (ids, names, lifecycle) reruns over all events, and the new events go through the same per-event validation and freezing as a full read. That is why we did not carry over the every-64-reads full revalidation: the retained state is only reused while the file is the same inode, has only grown, and still ends its consumed part with the same bytes, and the backend never rewrites committed bytes in place (the header reuse in `list()` relies on the same property). A periodic full pass would re-check exactly what those conditions and the per-read checks already cover.

**One contract made explicit.** Your note that continuing after `finish()` is safe is now a documented property of `dsh-session-format`: a current-version restore runs no migration stage, its `finish()` only validates, and it can decode later rows and finish again. Migrating restores still finish once.

**Numbers.** On a synthetic log (16-core Linux, Node v24.22.3, ~2 KB assistant messages), one appended turn reads in 31–51 ms against 289–363 ms for a full read at 30k events (zstd), and 47–85 ms against 545–648 ms at 90k events. The continued read still grows linearly with the event count because of the relationship pass and one array copy; decoding and validation are proportional to the appended bytes only.

As you found, this does not touch the O(corpus) cost of `session/list`; that stays a separate problem.

The branch is `fix/session-log-incremental-tail-read`, written from this thread; upstream does not accept external pull requests, so the branch sits on our fork: https://github.com/joei4cm/deepseek-harness/tree/fix/session-log-incremental-tail-read

# 中文对照（仅供阅读，不发布）

感谢堆分析与原型——把堆占用定位到 `readStoredLog` 下的 `consumeEventLine`，加上带正确性矩阵的补丁，让这件事成了直接移植而不是排查。

我们对照当前 `master`（`4b399c39a6`）接手了这个问题，并基本沿用你的设计：后端保留最近读取的当前版本日志的已打开 `SessionLogScanner` 与它已消费的字节；日志只是变长时，读取只解码新增的帧（或原始行），并继续同一个扫描器。上限也沿用你的取值——8 个日志、合计 250,000 个保留事件，按最久未读逐出——作为内部常量放在 `COLD_LOG_MEMO_MAX_ENTRIES` 旁边。

**继续读取检查什么。** 同一路径、同一 device 与 inode、文件变大、上次已消费部分的最后 64 字节未变、新的结尾处没有撕裂的帧或行，且扫描器报告全部输入已提交。其他任何情况——以及继续解码时的任何失败——都回退到现有的完整解码，错误分类不变。每次读取在解码前先认领保留的扫描器，所以同一 Session 的并发读取直接完整解码，不会共享一个推进到一半的解码器；取消照常传播。

**每次读取仍会运行什么。** 整个日志的关系检查（id、名称、生命周期）每次都对全部事件重新运行，新增事件经过与完整读取相同的逐事件校验与冻结。所以我们没有沿用每 64 次读取一次的全量重验：保留的状态只在文件仍是同一 inode、只是变长、且已消费部分的结尾字节未变时才被复用，而后端从不原地改写已提交的字节（`list()` 复用表头也依赖这一点）。定期全量检查要核对的，正是这些条件与每次读取的检查已经覆盖的内容。

**一条约定写明了。** 你提到「`finish()` 之后继续是安全的」，现在成为 `dsh-session-format` 的文档约定：当前版本的 restore 不经过迁移阶段，`finish()` 只做校验，可以继续解码之后的行并再次 finish。迁移中的 restore 仍只 finish 一次。

**数据。** 合成日志上（16 核 Linux，Node v24.22.3，助手消息约 2 KB），追加一轮后的读取在 3 万个事件时为 31–51 ms，完整读取为 289–363 ms（zstd）；9 万个事件时为 47–85 ms 对 545–648 ms。继续读取仍随事件数线性增长，原因是关系检查与一次数组复制；解码与校验只与新增字节成比例。

正如你观察到的，这不影响 `session/list` 遍历整个语料库的开销，那是另一个问题。

分支是 `fix/session-log-incremental-tail-read`，依据本帖编写；上游不接受外部 PR，所以分支在我们的 fork 上：https://github.com/joei4cm/deepseek-harness/tree/fix/session-log-incremental-tail-read
