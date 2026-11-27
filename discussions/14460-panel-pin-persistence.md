<!--
Status: draft, not published.
Target: Discussion #14460.
Do not publish without explicit user authorization and a fresh check for new comments.
-->

# English reply (draft)

We can confirm this on current `master` (`4b399c39a6`), and it is not a regression — pin choices were never persisted.

`packages/client/ui-sidebar/src/client/panel-pins.ts` `createPanelPins()` keeps the unpinned panel ids in a plugin-local snapshot store only, and `packages/client/ui-conversation/src/client/view-pins.ts` `createViewPins()` does the same for the view tabs. Nothing reads or writes a Host settings document, so every Web or Desktop restart starts from an empty list and every unpinned entry — including 自动化任务 — comes back. The package README records it as the current constraint ("Choices reset when the plugin reloads"), and Discussion #14245 reported the same gap for the same reason.

On our fork we have a fix ready as `feat/client-pins-persist-settings` (`049d966aae`): `dsh-client-ui-sidebar` gains a volatile Host config field `unpinnedPanels` and `dsh-client-ui-conversation` gains `unpinnedViews`, registered as user settings; the browser pin lists adopt the saved list when it arrives, merge choices made before it arrives, keep the optimistic value while a write is in flight, and roll back to the last accepted list if a write is refused. Ids of panels that are not registered yet stay in the saved list, so a panel registered late by a plugin does not lose its unpinned state.

Upstream does not accept external pull requests, so the branch sits on the fork; the link for reference: https://github.com/joei4cm/deepseek-harness/tree/feat/client-pins-persist-settings

# 中文对照（仅供阅读，不发布）

我们在当前 `master`（`4b399c39a6`）上确认了这个现象，它不是回归——固定选择从一开始就没有持久化。

`packages/client/ui-sidebar/src/client/panel-pins.ts` 的 `createPanelPins()` 只把取消固定的面板 id 保存在本插件的内存 snapshot store 里，`packages/client/ui-conversation/src/client/view-pins.ts` 的 `createViewPins()` 对视图标签同样如此。没有任何代码读写 Host 的设置文档，所以 Web 或 Desktop 每次重启都从空列表开始，所有取消固定的入口——包括「自动化任务」——都会回来。包 README 也把这条约束记录在案（“Choices reset when the plugin reloads”），Discussion #14245 报告的正是同一缺口。

在我们的 fork 上已有一个修复分支 `feat/client-pins-persist-settings`（`049d966aae`）：`dsh-client-ui-sidebar` 增加 volatile Host 配置字段 `unpinnedPanels`，`dsh-client-ui-conversation` 增加 `unpinnedViews`，注册为用户设置；浏览器侧的 pin 列表在保存值到达时采用它，把设置到达前的点击合并进去，写入在途时保持乐观值，写入被拒绝时回滚到最近一次被接受的列表。尚未注册的入口 id 仍保留在已保存列表中，所以插件较晚注册的面板不会丢掉取消固定状态。

上游不接受外部 PR，因此该分支暂存在 fork 上，供参考：https://github.com/joei4cm/deepseek-harness/tree/feat/client-pins-persist-settings
