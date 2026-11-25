<!--
状态：草稿，未发布。
用途：Discussion #14314 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/file-reference-prompt-dispose` 分支，未向上游开 PR。
-->

# English reply (for posting to Discussion #14314)

Thank you for the precise report. I verified the same failure mode on a fork branch: `disposePrompt()` called `.catch` directly on the `fiber.dispose()` result, so a bundled Cordis build whose `dispose()` returns `void` (or a build where it throws synchronously) turns every agent disposal into an `agent/disposed listener threw: TypeError` warning — masking real disposal failures and leaving the bookkeeping unregistered, exactly as you described.

The fix wraps the call itself rather than only the returned value:

```ts
const task = Promise.resolve().then(() => fiber.dispose()).catch((error: unknown) => {
  ctx.logger.warn(`file-reference-local: prompt cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
})
```

This mirrors Cordis's own defensive wrap (`Promise.resolve(this.dispose()).catch(...)`) and additionally routes a synchronous throw from `dispose()` through the same warning path; on builds that already return a `Promise` the behavior is unchanged.

A regression test stubs `ctx.inject` with a `dispose: () => undefined` fiber and asserts no `agent/disposed` listener warning is emitted; with the fix reverted it fails deterministically (negative control). The package suite passes locally (21 tests).

# 中文对照（仅供作者阅读，不发布）

感谢精确的报告。我在 fork 分支上核实了相同的失败模式：`disposePrompt()` 直接对 `fiber.dispose()` 的返回值调用 `.catch`，而打包的 Cordis 版本中 `dispose()` 可能返回 `void`（或同步抛出），使每次 agent 销毁都变成 `agent/disposed listener threw: TypeError` 告警——如你所述，它掩盖真实的销毁失败且未登记清理记账。

修复包住的是调用本身而不是返回值：

```ts
const task = Promise.resolve().then(() => fiber.dispose()).catch((error: unknown) => {
  ctx.logger.warn(`file-reference-local: prompt cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
})
```

这与 Cordis 自己的防御性包装（`Promise.resolve(this.dispose()).catch(...)`）一致，并额外把 `dispose()` 的同步抛出纳入同一警告路径；对已经返回 `Promise` 的构建行为不变。

回归测试用一个 `dispose: () => undefined` 的 fiber 桩住 `ctx.inject`，断言不再产生 `agent/disposed` 监听器告警；还原修复后该测试确定性失败（负向控制）。包级测试套件本地通过（21 项）。
