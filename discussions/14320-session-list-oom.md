<!--
状态：草稿，未发布。
用途：Discussion #14320 的回复正文，供作者过目后决定是否发布。
说明：对照当前 master（4b399c39a6）；列表路径已在合成语料上实测（860 个会话，
zstd，含 20→60 个 30k 事件日志）。只回应 session/list 成本；日志读取路径
由 fix/session-log-incremental-tail-read 分支处理。
-->

# English reply (for posting to Discussion #14320)

Thank you for publishing the prototype, the measurements, and the production updates. This reply covers only the `session/list` cost you reported in the first follow-up (43.7 s and 60.3 s for two consecutive calls on 843 stored sessions, with the tail patch active). We measured the listing path on current `master` (`4b399c39a6`), which matches the 0.2.2-rc.1 listing code:

- `persistence.list()` enumerates one directory per Session and reads each log's generation header from its first zstd frame (the header line is always its own frame, including after appends). Headers are memoized by file revision, so a listing re-reads a header only when that log changed.
- Cold list rows read the in-memory projection-cache table by header; a listing never opens a Session log and never seeds a fold.

On a synthetic corpus (local Linux, Node v24.22.3, tmpfs-backed root, zstd, one frame per append batch):

| Scenario | List time |
|---|---|
| 860 sessions (20 with 30,000-event logs), first list, empty header memo | 562.8 ms |
| same corpus, warm list | 34.0–65.7 ms |
| same corpus after 5 sessions append one batch | 78.4 ms |
| same corpus with 60 sessions grown to 30,000 events, first list | 587.0 ms |
| same, warm | 85.9 ms |

Adding forty 30,000-event logs (~7 MB plaintext each) moved a cold listing by ~24 ms, so the listing cost is O(Session count) and independent of log size on this source; the "warm" number also matches your later production observation of 0.5–0.9 s on 819 sessions.

Two consecutive 43.7 s / 60.3 s warm calls do not come from this path on the code we measured — after the memoized headers are populated, the per-call work is directory entries, one `stat` per log, and in-memory summaries. Since the same patched build later listed in 0.5–0.9 s, we suspect the slow pair was taken while the process was still executing full decodes elsewhere (or under the gateway/disk contention described in your second update). If a multi-second list reproduces again, a CPU profile captured during the slow call (`node --cpu-prof` on the Host process) would attribute it directly; the projection-cache and listing stages are easy to tell apart there.

The byte-indexed page table remains relevant to the log-read path, not to listing. Our tail-read work (continued decode of grown current-version logs) addresses that side; we will share it once reviewed.

# 中文对照（仅供作者阅读，不发布）

感谢公开原型、测量与生产更新。本回复只谈第一条跟进里报告的 `session/list` 耗时（843 个已存储会话、tail 补丁生效下连续两次 43.7 s / 60.3 s）。我们在当前 `master`（`4b399c39a6`）上实测了列表路径，它与 0.2.2-rc.1 的列表代码一致：

- `persistence.list()` 每个 Session 枚举一个目录，并从每个日志的第一个 zstd frame 读 generation header（header 行总是独立成帧，追加后也一样）。header 按文件版本记忆化，只有日志变化时才会重读。
- 冷列表行按 header 查内存中的投影缓存表；列表从不打开 Session 日志，也不会启动 fold。

合成语料实测（本机 Linux，Node v24.22.3，tmpfs 根目录，zstd，每次追加一个帧）：

| 场景 | 列表耗时 |
|---|---|
| 860 个会话（20 个 30,000 事件日志），首次列表（header 记忆化为空） | 562.8 ms |
| 同一语料，热列表 | 34.0–65.7 ms |
| 5 个会话各追加一批后列表 | 78.4 ms |
| 60 个会话长到 30,000 事件后首次列表 | 587.0 ms |
| 同一语料，热列表 | 85.9 ms |

新增四十个 30,000 事件日志（每个约 7 MB 明文）只让冷列表增加约 24 ms，因此在这份源码上列表成本是 O(会话数)、与日志大小无关；"热"数值也与你们后来 819 会话 0.5–0.9 s 的生产观测一致。

在记忆化已填充后，连续两次热调用要花 43.7 s / 60.3 s，在我们实测的代码上无法由这条路径产生。既然同一个打过补丁的构建后来 0.5–0.9 s 就能列完，我们怀疑那一对慢调用是在进程仍在别处执行全量解码（或你们第二条更新所述网关/磁盘争用）时测得的。如果再复现秒级列表，建议在慢调用期间对 Host 进程抓 CPU profile（`node --cpu-prof`），可以直接归因；列表与投影缓存两个阶段在其中很容易区分。

字节索引页表对日志读取路径仍有价值，对列表没有必要。我们的 tail-read 工作（变长的当前版本日志的续读）处理的是读取这一侧，评审后会分享。
