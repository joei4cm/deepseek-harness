<!--
状态：草稿，未发布。
用途：Discussion #14259 的回复正文，供作者过目后决定是否发布。
目标渠道：上游仓库的 Discussions（上游 CONTRIBUTING 声明不接受外部 PR、Issues 已关闭，Discussions 是唯一被认可的反馈渠道）。
说明：本仓库是 fork；提案 1（事件驱动的 waitForExit）已在分支 fix/subprocess-fallback-wait-child-exit 上实现，未向上游开 PR。
-->

# English reply (for posting to Discussion #14259)

Both halves check out on `master` (0.2.3-alpha.2), and the remaining one is implemented on a fork branch.

**What is already fixed and what remains**

You are right that `linuxProcessGroupLiveMember(pgid, knownMember)` with its `knownMember` fast path already removed the per-call full-table scan. What remains is exactly what your profile showed: the fallback owner loops `alive()` every 15 ms regardless of whether the direct child is still running —

```ts
observation ??= (async () => {
  while (alive()) await sleepTick()   // 15 ms cadence, unconditional
  stopped = true
})()
```

Each tick pays a synchronous `process.kill(-pgid, 0)` group probe, and after the leader settles it adds one `/proc/<pid>/stat` read. On a 144-core host with ~2 870 processes and 4 waiters, that is roughly 267 group probes a second — and while the leader is alive, none of them can prove the group empty, because the leader is still a member and the wait cannot resolve anyway.

**Implemented on `fix/subprocess-fallback-wait-child-exit` (based on `dsh-v0.2.3-alpha.2`)**

The wait now has two phases:

- While the direct child is still running, it hangs off the child's own `exit` event. `direct` is already the `ChildProcess` exit promise, so the liveness fact is free. A 15 ms timer still fires as a safety net, but on each wake the synchronous probe is skipped — a `kill(-pgid, 0)` there can only ever confirm liveness.
- Once the direct child has settled, the 15 ms liveness schedule starts. That is the only point a probe can actually prove the group empty (zombie members, an unreadable `/proc`, or a real survivor), and the only point the wait can resolve.

A no-survivor wait — the common path for a `bash` command that simply runs to completion — now ends with the `exit` event and zero probes instead of ~67 a second. A survivor wait pays the same per-tick cost as before, which is the right price: that is the only time a probe buys information.

The semantics that matter are unchanged: `ESRCH` still means gone, `EPERM` still means alive, the `knownMember` fast path still avoids the table scan once a member is found, and `stopped` still marks the no-more-signals boundary.

**On your suggestions**

- Driving `waitForExit` from the child `exit` event "when the launched child is the group's only member" — in the common case it is the only member Node can see, so the event-driven wait applies everywhere, not just as a narrow optimization. That is what this change does: the event is the wake, not a special case.
- A short-TTL cached snapshot for the multi-member case would still leave a synchronous read on the event loop at whatever cadence; the event-driven phase removes the wait entirely in the no-survivor case, and the `knownMember` fast path already covers the survivor case at one file per tick, so I have not added a second cache layer.

I cannot run your reproduction harness on this machine (its 144-core/`/proc` scale is exactly what this wait was designed around), but the probe-count assertions in the new test hold the behavior: zero group probes while the leader lives, at most three synchronous probes after it settles. The branch is on my fork; I have not opened a pull request, since `CONTRIBUTING.md` states that external pull requests are not accepted — happy to hand over the branch, a patch, or a diff in whatever form is useful.

# 中文对照（仅供作者阅读，不发布）

两半都能在 `master`（0.2.3-alpha.2）上核实，剩下的一半已在 fork 分支上实现。

**已修好的部分与剩下的部分**

你说得对，`linuxProcessGroupLiveMember(pgid, knownMember)` 的 `knownMember` 快路径已经去掉了每次调用都扫全表的代价。剩下的正是 profile 里看到的东西：fallback owner 以 15 ms 节奏循环 `alive()`，无论 direct child 是否还活着——

```ts
observation ??= (async () => {
  while (alive()) await sleepTick()   // 15 ms 节奏，无条件
  stopped = true
})()
```

每个 tick 付出一次同步 `process.kill(-pgid, 0)` 组探测，leader 结算后再加一次 `/proc/<pid>/stat` 读。144 核、约 2870 进程、4 个等待者的宿主上，约每秒 267 次组探测——而 leader 存活期间，这些探测都无法证明组为空（leader 仍是成员，wait 也无法 resolve）。

**已在 `fix/subprocess-fallback-wait-child-exit`（基于 `dsh-v0.2.3-alpha.2`）实现**

等待拆成两段：

- direct child 仍在运行时，等待挂在子进程自己的 `exit` 事件上。`direct` 本来就是 ChildProcess 的 exit promise，存活事实零成本。15 ms 计时仍作为保险网保留，但每次唤醒时跳过同步探测——`kill(-pgid, 0)` 在这里永远只能确认存活。
- direct child 结算后才开始 15 ms 存活检查。这是探测唯一可能证明组为空（zombie 成员、`/proc` 不可读、真实存活者）且 wait 唯一能 resolve 的时刻。

无存活者的等待——`bash` 命令跑完即结束的常见路径——现在随 `exit` 事件结束，组探测 0 次，不再每秒约 67 次。有存活者的等待付出与之前相同的 per-tick 成本，这价格合理：那是探测真正能买到信息的唯一时段。

关键语义不变：`ESRCH` 仍视为消失，`EPERM` 仍视为存活，`knownMember` 快路径仍在找到成员后免表扫描，`stopped` 仍是 no-more-signals 边界。

**关于你的两条建议**

- 「当启动的子进程是组内唯一成员时，由 exit 事件驱动 waitForExit」——在常见情况下它就是 Node 能看到的唯一成员，所以事件驱动适用于所有情形，不只是窄优化。本次改动正是：事件是唤醒来源，而不是特殊分支。
- 「多成员情形下用短 TTL 缓存快照」仍会在其节奏上向事件循环付出同步读；事件驱动段在无存活者时完全去掉等待，`knownMember` 快路径在有存活者时每 tick 一个文件，所以没有再加第二层缓存。

本机无法跑你的复现 harness（144 核 / `/proc` 规模正是这次等待设计的场景），但新测试中的探测计数断言钉住了行为：leader 存活期间 0 次组探测，结算后至多 3 次同步探测。分支在我的 fork 上；我没有开 PR，因为 `CONTRIBUTING.md` 声明不接受外部 PR——需要的话我可以交出分支、patch 或 diff，任何形式都可以。
