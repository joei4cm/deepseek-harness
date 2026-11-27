<!--
状态：草稿，未发布。
用途：Discussion #14417 的回复正文，供作者过目后决定是否发布。分析性回复，不接修复（报告者已有本地缓解；是否上调优先级属维护者裁决）。
核对基线：上游 master（4b399c39a6）。
-->

# English reply (for posting to Discussion #14417)

A code-level map of the contention you measured, plus the design axes your question touches; the scheduling decision itself stays with the maintainers.

**Your read of the mechanism is right, and one part is already "a separate path."** An exact open never shares the listing queue today: `findLog` probes one candidate directory per project with unbounded `readdir`/`stat`, and `requireStoredLog` → `readStoredLog` → `decodeStoredLog` reads and decodes the artifact without touching `listLimit` (`packages/session/session-persistence-jsonl/src/index.ts:1691`, `:650`, `:884`). The listing limiter itself is deliberately listing-adjacent only — it admits work for `mapSessionDirectories`, `historicalCorpusRevision`, and `listArtifacts` (`:1184`, `:1206`, `:1235`) and nothing else. So the contention your harness measures is two-sided, not a lock: the whole-log decode is main-thread work (the frame decoder calls `zstdDecompressSync` per frame in `zstd-public-decoder.ts` and only yields through `scheduler.yield` between frames, `index.ts:1077`), while every listing probe — `readdir`, `stat`, `handle.read`, and the header-frame `zstdDecompress` in `readFirstZstdLine` (`index.ts:1615`) — is thread-pool work. At `listConcurrency: 3` three of the default four libuv threads stay busy with queued probes, and the interactive decode's scheduled yields return into an event loop that keeps processing listing completions. Your reverse-order run under lower load fitting the pattern is consistent with both halves.

**Whether to prioritize exact reads upstream: the shape fits, the placement is the decision.** The cooperative variant you describe (in-flight probes finish, queued probes wait) matches the tree's existing cooperative decode, and two mechanics satisfy it while preserving every documented ordering:

- A pause gate inside the listing limiter: interactive opens mark themselves in-flight and the limiter stops admitting new listing tasks until the count drains. Queue ordering inside `settleLimited` is untouched; the only new element is admission, not ordering.
- A second budgeted lane: interactive lookups and current-log reads run through a smaller separate bound, so listings keep progress instead of pausing. This splits a four-thread pool two ways and needs a starvation bound of its own.

Two invariants constrain either form. Listing tasks must never wait on the same limiter (`settleLimited`/`mapSessionDirectories` JSDoc states it, and exact reads must stay off the queue for the same reason — the task contract, not just performance). And the duplicate-id check in `findLog` scans every project directory by design, so a true "indexed exact lookup" that skips the scan would weaken corruption detection — worth knowing if a separate-path variant is considered.

**What scheduling cannot fix.** A cold listing decodes one zstd frame per stored log after `stat` — that is intrinsic work (the header cache only skips logs whose revision is unchanged), and the interactive open decodes the whole target log on the main thread. Priority ordering bounds what a listing delays; it does not reduce either total. The two orthogonal owners you cited cover the absolute costs: #12627 for whole-log cold decode, #14020 for repeated catalog enumeration. A deployment-side lever that exists today is `UV_THREADPOOL_SIZE`, which widens the shared pool rather than ordering it.

If the maintainers take the direction, the natural scope looks backend-local (the JSONL backend already owns `listConcurrency`), and your acceptance test — hold an exact read open and verify queued listing work waits and then completes — is the right regression shape for it.

# 中文对照（仅供作者阅读，不发布）

对照代码核对你测到的争用机制，并把问题触及的设计轴摆开；调度裁决本身留给维护者。

**你对机制的判断是对的，且其中一部分已经是「独立路径」。** 今天的精确打开本就不与 listing 共用队列：`findLog` 对每个 project 目录只做一次无界 `readdir`/`stat` 探查，`requireStoredLog` → `readStoredLog` → `decodeStoredLog` 的读取与解码完全不经过 `listLimit`（`packages/session/session-persistence-jsonl/src/index.ts:1691`、`:650`、`:884`）。listing 限流器本身刻意只服务于 listing 侧——只为 `mapSessionDirectories`、`historicalCorpusRevision`、`listArtifacts`（`:1184`、`:1206`、`:1235`）放行，别无他处。所以你测到的争用是两边的，而不是同一把锁：整日志解码是主线程工作（`zstd-public-decoder.ts` 逐帧 `zstdDecompressSync`，只在帧间经 `scheduler.yield` 让出，`index.ts:1077`），而每个 listing 探查——`readdir`、`stat`、`handle.read`、以及 `readFirstZstdLine` 里每帧的 `zstdDecompress`（`index.ts:1615`）——都落在同一个线程池上。`listConcurrency: 3` 时默认四个 libuv 线程里三个被排队探查占住，交互解码的调度让出落回一个仍在处理 listing 完成回调的事件循环。你在低负载下反向顺序跑出混合结果，与两边分摊的机制一致。

**是否值得上游给精确读取排优先级：方向契合，落点才是裁决点。** 你描述的合作式变体（在飞的探查跑完、排队的等待）与树里已有的合作式解码同款；有两种机制能满足它且不破坏任何已记录顺序：

- 在 listing 限流器内置一个暂停门：交互打开期间登记在飞计数，限流器停止放行新探查直到计数清空。`settleLimited` 的队列顺序原样保留——新增的是放行，不是排序。
- 第二条受限通道：精确查找与当前日志读取走一个更小的独立配额，listing 保持推进而非暂停。四线程池要分成两半，同样需要自己的饥饿上限。

两条不变量约束任一形态。listing 任务绝不能等待同一个限流器（`settleLimited`/`mapSessionDirectories` 的 JSDoc 写明，精确读取也必须因此留在队列外——这是任务契约而非单纯性能）。而 `findLog` 的重复 id 检查按设计扫描全部 project 目录，一个跳过扫描的「索引化精确查找」会削弱损坏检测——评估独立路径变体时需要知道这一点。

**调度解决不了的部分。** 冷 listing 在 `stat` 之后对每个存盘日志解码一个 zstd 帧——这是固有工作（头部缓存只跳过 revision 未变的日志），交互打开又要在主线程上解码整份目标日志。优先级排序能限制 listing 拖延多久，并不减少任何一边的总量。你引用的两个既有归属覆盖了绝对成本：#12627 管整日志冷解码，#14020 管重复目录枚举。今天已有的部署侧杠杆是 `UV_THREADPOOL_SIZE`，它扩的是共享池本身而不是顺序。

若维护者采用这个方向，自然的作用域看起来是后端局部（JSONL 后端本就拥有 `listConcurrency`），你的验收用例——保持一个精确读取打开、验证排队的 listing I/O 等待并最终完成——正是它应有的回归形态。
