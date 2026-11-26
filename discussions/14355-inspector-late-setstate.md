<!--
状态：草稿，未发布。
用途：Discussion #14355 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/inspector-late-setstate-after-close` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）；第一段 ECONNRESET 的成因未定位，本稿只处理第二段崩溃放大。
-->

# English reply (for posting to Discussion #14355)

Your minimized reproduction matches the current tree exactly, and the mechanism you describe is the whole story of the second-stage crash:

- `HostBridgePublisher.publish()` returns quietly when the source is closed, but `setState()` throws `inspector: Host source is closed` in the same state.
- The Cordis observer listens for `internal/plugin` and `internal/status` and publishes through `publisher.setState(...)`, so any Cordis notification that lands after the unexpected-Worker-exit callback closed the source turns into a throw inside a microtask — an uncaught exception, and with it the Desktop Host.
- Nothing in the observer's lifecycle is tied to the source's: the observer is disposed only by the plugin's disposer list, while the failure path in `startInspector` closes the source on its own.

I fixed the amplification on a fork branch (`fix/inspector-late-setstate-after-close`, based on upstream `master`):

1. **A closed source drops publications instead of raising.** `publish()` and `setState()` now behave the same way once the source is closed, in the Host and the Client publisher alike. The failure that closed the source stays reported by its owner (`dsh inspector: Worker stopped unexpectedly`), so nothing is hidden — the second, process-fatal error simply disappears. Your minimized reproduction now completes without an exception.
2. **The Cordis observer stops when its publisher closes.** `InspectorStatePublisher` gained `isClosed()`, and the observer ends its observation on the first notification that arrives after the source closed. Before this, a failed Inspector kept building a full realm snapshot on every plugin/status notification and dropped the result; now the listeners and the retained snapshot are released with the source.
3. **A regression test covers the race**: the minimized close-then-publish path, a Cordis mutation that arrives after the close, and the observer's stop are pinned in `packages/experimental/inspector/tests/closed-source.host.spec.ts` and `closed-source.client.spec.ts`.

Two notes on scope. I kept the change narrow and did not introduce a new error type: the closed source is a terminal state with no consumer left to act on the failure, so a typed "source closed" error would only give the observer another way to route a condition it can already detect. And I did not identify the socket that produced the first-stage `read ECONNRESET` — like you, I only removed the crash amplification it used to cause; that first error is still worth a separate look at the ingest socket's shutdown path.

The branch and a full pull-request description are ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

# 中文对照（仅供作者阅读，不发布）

你的最小复现与当前代码树完全吻合，你描述的机制就是第二段崩溃的全部成因：

- `HostBridgePublisher.publish()` 在 source 关闭时静默返回，而同一状态下的 `setState()` 抛 `inspector: Host source is closed`。
- Cordis 观察者监听 `internal/plugin` 与 `internal/status`，并通过 `publisher.setState(...)` 发布；因此任何落在「Worker 意外退出回调已关闭 source」之后的 Cordis 通知，都会变成微任务里的抛错——未捕获异常，并随之带走 Desktop Host。
- 观察者的生命周期与 source 的生命周期没有任何绑定：观察者只由插件的 disposer 列表释放，而 `startInspector` 里的失败路径自行关闭了 source。

我在 fork 分支（`fix/inspector-late-setstate-after-close`，基于上游 `master`）上修复了这个放大器：

1. **关闭的 source 丢弃发布，不再抛错。** Host 与 Client 的 publisher 在关闭后，`publish()` 与 `setState()` 行为一致。关闭 source 的那次失败仍由其所有者报告（`dsh inspector: Worker stopped unexpectedly`），没有信息被隐藏——只是第二个进程级致命错误消失了。你的最小复现现在可以正常跑完，不再抛异常。
2. **publisher 关闭后 Cordis 观察者停止观察。** `InspectorStatePublisher` 新增 `isClosed()`，观察者在 source 关闭后收到的第一次通知即结束观察。此前一次失败的 Inspector 会在每次插件/状态通知时仍然生成整棵 realm 快照再丢弃结果；现在监听器与保留的快照随 source 一并释放。
3. **回归测试覆盖该竞态：** 关闭后再发布的最小路径、关闭后到达的 Cordis 变更，以及观察者的停止，都固定在 `packages/experimental/inspector/tests/closed-source.host.spec.ts` 与 `closed-source.client.spec.ts`。

两点范围说明。我保持了改动窄小，没有引入新的错误类型：关闭的 source 是一个终态，已经没有消费方能对该失败采取行动，新的「source 已关闭」错误类型只会给观察者多一条本已能自行判断的分支。另外，我没有定位到产生第一段 `read ECONNRESET` 的那个 socket——和你一样，我只移除了它造成的崩溃放大；第一段错误仍值得单独排查 ingest socket 的关闭路径。

分支与完整的 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。
