<!--
Status: draft, not published.
Target: Discussion #14446.
Do not publish without explicit user authorization and a fresh check for new comments.
-->

# English reply (draft)

Thanks for the report and for the control experiment — the clean-process comparison and the `ownerContext.root === ctx.root` check are what made the shape of the problem visible.

We took this on against current `master` (`4b399c39a6`) and reached the same conclusion your investigation direction 2 points at. The root Include is recorded in a module-level `WeakMap` that only the copy of `@deepseek-ai/dsh-app-boot` that ran `mountRootInclude()` ever writes to. When a second copy of the package exists in the same host process — which is what a plugin resolved through `internal.import(specifier, bareModuleBaseUrl)` against another module base produces, since the same file then has two URL forms — the copy that `dsh-hmr` and `dsh-config-editor` call into has an empty `WeakMap`, and every reload throws `profile reload requires the root Include entry`. Nothing about the profile, the installation path, the working directory, or the IPC channel changes that, which is consistent with your clean-process control succeeding.

Our branch is `fix/app-boot-bootstrap-include-marker` (`8f50cac3318a2d41020944d9c1ad72f374d3d3cf`), written from your report rather than from a comparison branch.

The implementation:

- `mountRootInclude()` also marks the root Include entry on the loader service itself, under a globally shared symbol. Both copies of the package share one loader service, so both read the same marker. `recompose()` still answers from the context-keyed record first, and only reads the loader marker when that record misses.
- The two remaining class-identity checks are read by shape instead: a resolution is recomputable when it offers `computeLatestResolution`, and a rejected publication is a restart signal when it is a `ResolutionRestartRequired` or carries that error name. In a second copy, both classes are different objects, so `instanceof` alone could never have matched.
- The public functions, their error text, and the reload semantics are unchanged. When no root Include exists at all, the same `${binName}: profile reload requires the root Include entry` is still thrown.

On the three suggestions in your report: we chose to repair the lookup rather than to degrade. The root Include does exist — this boot mounted it — so returning `restart-required` would turn a change that can be applied live into one that needs a restart, which is the opposite of the expected behavior you wrote down. Degrading remains a reasonable fallback for a host whose root Include genuinely cannot be found, and we would take a separate change for the diagnostics you proposed (`ctx.fiber.name`, root fiber id, and whether an `id === 'include'` entry exists) if you want them; we did not add them here because they would widen the diff beyond the failure.

Your workaround plugin stays valid as a stopgap: it degrades the failure to `restart-required` and passes the healthy path through unchanged. With the branch above, the healthy path is the one that runs.

Validation: the package suite passes (22 files / 5689 tests); the changed file reaches 100% statement, branch, function, and line coverage together with the `dsh-hmr`, `dsh-plugin-manager`, and `dsh-config-editor` suites, which are the callers of these functions (27 files / 706 tests). Two new cases fail against `master`'s sources and pass with the change. Host typecheck, lint, and the documentation gates pass; `pnpm run doc-sync` reports 2 failures that are pre-existing in the repository and unrelated to this diff.

One limit on the evidence: this checkout cannot reproduce the packaged desktop shape (asar plus a bare module base), so the new cases simulate the second copy with a re-import of the module after `vi.resetModules()`. Your host-process comparison remains the end-to-end evidence for that path — if you can log the module URL the failing copy resolves to, that would confirm or correct the dual-instance explanation directly.

Upstream does not accept external pull requests, so the branch sits on the fork.

# 中文对照（仅供阅读，不发布）

感谢这份报告，也感谢那个对照实验——干净进程里的比较与 `ownerContext.root === ctx.root` 的检查，正是让问题形状变得可见的关键。

我们对照当前 `master`（`4b399c39a6`）接手了这个问题，结论与你的排查方向 2 一致：根 Include 被记录在一个模块级 `WeakMap` 里，只有执行过 `mountRootInclude()` 的那一份 `@deepseek-ai/dsh-app-boot` 写入过它。当同一个宿主进程里存在第二份本包时（插件经 `internal.import(specifier, bareModuleBaseUrl)` 解析到另一份模块基址就会产生这种局面——同一文件于是有了两种 URL 形态），`dsh-hmr` 与 `dsh-config-editor` 调到的那一份实例的 `WeakMap` 是空的，于是每次热重载都抛出 `profile reload requires the root Include entry`。profile 内容、安装路径、工作目录、IPC 通道都不会改变这一点，这与你在干净进程里控制实验成功是一致的。

我们的分支是 `fix/app-boot-bootstrap-include-marker`（`8f50cac3318a2d41020944d9c1ad72f374d3d3cf`），依据你的报告写成，不是从对比分支改的。

实现如下：

- `mountRootInclude()` 在挂载根 Include 时，也会把该 Entry 标记到 loader 服务自身，用的是一个全局共享的 symbol。两份本包实例共享同一个 loader 服务，因此读到的是同一份标记。`recompose()` 仍然先查按 Context 记录的 WeakMap，只有查不到时才去读 loader 上的标记。
- 剩下两处类身份判断改为按形状判断：resolution 只要提供 `computeLatestResolution` 就可重算；发布被拒时，只要它是 `ResolutionRestartRequired` 或带着这个错误名，就算重启信号。在第二份实例里这两个类都是不同的对象，单靠 `instanceof` 永远匹配不上。
- 公开函数、错误文案与重载语义都不变。确实没有根 Include 时，仍然抛出原来的 `${binName}: profile reload requires the root Include entry`。

关于报告里的三条建议：我们选择修复查找，而不是降级。根 Include 是存在的——它就是这次启动挂上去的那一个——把它降级成 `restart-required`，等于把一次本可热应用的改动变成必须重启，与你写的期望行为相反。如果确实存在拿不到根 Include 的宿主进程，降级仍然是合理的兜底；你提出的诊断信息（`ctx.fiber.name`、根 fiber id、是否存在 `id === 'include'` 的 entry）可以作为另一个独立改动来做，这次没有加，因为那会把改动范围撑到失败之外。

你的临时插件作为止血手段依然有效：它把失败降级为 `restart-required`，健康路径原样透传。应用上面的分支之后，走的是健康路径。

验证：包内测试全绿（22 个文件 / 5689 个测试）；改动文件与 `dsh-hmr`、`dsh-plugin-manager`、`dsh-config-editor` 三套测试合起来达到语句、分支、函数、行 100% 覆盖——这三处正是调用这些函数的调用方（27 个文件 / 706 个测试）。2 个新用例在 `master` 的源码下失败、在改动后通过。host typecheck、lint 与文档门禁通过；`pnpm run doc-sync` 的 2 个失败是仓库既有问题，与本次改动无关。

一点证据局限：本检出无法复现桌面版的打包形态（asar 加 bare module base），因此新用例用 `vi.resetModules()` 之后的重新 `import` 模拟出第二份实例。桌面宿主进程中的对照仍然是这条路径的端到端证据——如果你能打印出失败那一份实例解析到的模块 URL，就能直接确认或推翻「两份实例」这个解释。

上游不接受外部 PR，因此该分支暂存在 fork 上。
