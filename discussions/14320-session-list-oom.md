<!--
状态：草稿，未发布。
用途：Discussion #14320 的回复正文，供作者过目后决定是否发布。
说明：源码侧核对两条成本路径（附着解码 vs 枚举投影缓存）；接受何种读法方向属维护者决定；未运行报告者补丁。
-->

# English reply (for posting to Discussion #14320)

The source side is consistent with both halves of your measurement — and with why the tail patch fixes only one of them:

- **The attach/access path is the full-decode one.** `SessionLogScanner` is consumed whole in `decodeStoredLog` (`dsh-session-persistence-jsonl`): the file is read and every zstd frame decoded before the session materializes, so each re-access of an attached-or-cold session pays O(log size) again. Your continue-the-live-scanner approach is aimed exactly there, and the fallback matrix you tested (shrink / rename / torn frame → full decode) is the right set of non-append deviations to cover.
- **Enumeration is a separate path, so your `session/list` reading is expected, not a patch defect.** `persistence.list()` reads only the first frame of each log (memoized by file revision in `listedHeaders`), and cold-row summaries read `sessionProjectionCache` by header — a listing deliberately never seeds a fold. The 43–60 s on 843 sessions therefore sits in the enumeration fan-out itself, not in per-log decode; a tail-read cache cannot help it, which is exactly what you observed. That argues the two costs want different fixes rather than one window mechanism serving both.
- On the direction question — windowed/byte-indexed read vs a memoized document — only the maintainers can accept a change, but the tree already carries one precedent for the "index beside the log" idea: `dsh-session-projection-cache` exists to keep cold listing off the decode path, and `dsh-session-persistence-sqlite` is the backend that materializes that same separation natively. Framing the proposal as closing the JSONL backend's gap toward that same separation may be the most reviewable form.
- Two properties of your prototype worth keeping in whatever shape lands: results are **frozen copies** while the live collector stays unfrozen (the existing contract relies on callers not mutating shared event objects), and the periodic full re-validation every N incremental reads — without it, a silent non-append write that the inode/size checks miss would corrupt the memo permanently.
- The two deployment caveats (single-shared-SQLite auth gateway; tmpfs filling from `dsh-workspace-changes-*` + tmpfs build dirs → ENOSPC exit) are worth keeping in this thread — the ENOSPC-on-tmpfs failure mode in particular masquerades as harness instability.

For handover: attaching the patch, the benchmark harness, and the fixture set (or the corpus characteristics) to this Discussion would make the review self-contained; a format-patch plus the reproduction data is the sanctioned form while external PRs are paused. Whether to accept a windowed read inside `dsh-session-persistence-jsonl` — versus pushing listing-heavy deployments to the SQLite backend — is the maintainer call.

# 中文对照（仅供作者阅读，不发布）

源码侧与你们两段测量都一致——也解释了为什么 tail 补丁只能修其中一半：

- **附着/访问路径确实是全量解码。** `decodeStoredLog` 中 `SessionLogScanner` 一次性读尽（`dsh-session-persistence-jsonl`）：文件整体读入、所有 zstd 帧解码后才物化 Session，每次重访都要再付 O(日志大小)。你们「延续 live scanner」的思路正对准这里，fallback 矩阵（shrink/rename/残帧→全解码）也覆盖对了非追加异常集合。
- **枚举是另一条路径，所以 session/list 的读数是预期的，不是补丁缺陷。** `persistence.list()` 只读每个日志的首帧（`listedHeaders` 按文件版本记忆），冷行摘要从 `sessionProjectionCache` 按 header 取——列表路径刻意不做 fold。843 会话 43–60s 的开销在枚举扇出本身而非逐日志解码；tail 缓存帮不了它，与观测吻合。这反而说明两项成本需要两个修法，而非一个 window 机制通吃。
- 方向问题（windowed/字节索引读 vs 记忆化文档）只能由维护者拍板，但仓库里已有「日志旁建索引」的先例：`dsh-session-projection-cache` 正是为让冷列表绕开解码而存在，`dsh-session-persistence-sqlite` 则是原生实现同一分离的后端。把提案表述为「让 JSONL 后端补齐与 SQLite 同等的分离」可能是最易评审的形态。
- 原型里两个性质值得在任何落地形态中保留：结果返回**冻结副本**而 live collector 不冻结（现有契约依赖调用方不改动共享事件对象）；以及每 N 次增量读做一次全量重校验——没有它，一次未被 inode/size 检查发现的静默非追加写会永久污染 memo。
- 你们记录的两个部署侧坑（单连接共享的 SQLite 鉴权网关；tmpfs 被 `dsh-workspace-changes-*` 与构建目录填满→ENOSPC 退出）值得留在本帖——尤其 tmpfs ENOSPC 这种失败形态极易被误读为 harness 不稳定。

交接建议：把补丁、基准脚本与夹具（或语料特征）附在本帖，让评审自足；外部 PR 暂停期间 format-patch + 复现数据是既定形式。是否接受 JSONL 后端内建 windowed 读、还是建议重列表负载部署迁往 SQLite 后端，由维护者决定。
