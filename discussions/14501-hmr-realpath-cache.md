# #14501 — HMR stale realpath cache after a package link swap (draft, unpublished)

Status: no takeover claim or reply has been published to upstream; the permission classifier denied the takeover pattern on the neighbouring discussions (#14482, #14495), so this reply stays an unpublished draft until the user authorizes posting for #14501 specifically.

## English

Reproduced on Node 26.12.1 against current `master` (`841f76d3c5`) with your `repro.mjs`: the `cold` and `hot` runs succeed, and the `swap` run fails with `ENOENT: no such file or directory, lstat '<profile>/vendor'` after pnpm reports the `link:` install as successful.

Root cause: Node's persistent realpath cache keeps the `installed directory → realpath` entry of the old package directory. After the bundle is removed and re-installed as a `link:` package, the new package entry is still resolved through the old profile spelling, so the package's relative `vendor` symlink resolves to `<profile>/vendor` — a path that does not exist — instead of the `vendor` directory inside the link target. The failing frame is Node's own `ModuleLoader.resolveSync` → `finalizeResolution` → `realpathSync`, which is why the error names a path that the profile never contained.

Fix on branch `fix/hmr-purge-stale-realpath-cache`: when HMR invalidates a package manifest, it now also purges Node's native realpath cache entries below that package directory, in addition to the ESM `ResolveCache` and the CommonJS `_pathCache` it already cleared. Node 26 exposes the needed helper (`internal/modules/helpers`'s `purgeRealpathCacheForPrefix`); on Node 24 the helper does not exist and the invalidation keeps its previous behavior, so the change is inert there.

Evidence: with the fix, the same `swap` repro exits 0 and reports `application: applied` with the nested vendor marker loaded; the HMR suite passes 241 tests on both Node 26.12.1 and Node 24.22.3 with `package-manifest.ts` at 100% statement, branch, function, and line coverage. Negative control: with `package-manifest.ts` reverted to `master`, the new test fails because the purge is never called.

One boundary we did not cover in this change: Node 24 keeps its own persistent realpath caches — one in `internal/modules/helpers`, one in `internal/modules/esm/resolve` — and exports no purge helper, so the same directory-to-link replacement still resolves through the old directory there. Node 26 unifies both caches behind `purgeRealpathCacheForPrefix`, which is what this change calls. Clearing Node 24's two private caches means capturing the cache objects that `fs.realpathSync` receives internally, which is a larger change than we wanted to land without discussion; we documented it in the package README's known limitations and would take a follow-up for it.

One deliberate boundary: the purge is scoped to the invalidated package directory, matching the scope of the existing manifest invalidation. Entries cached for other directories are left to Node's own expiry, since a broader purge would evict resolution state the HMR instance does not own.

## 中文

已在 Node 26.12.1 上用你的 `repro.mjs` 在当前 `master`（`841f76d3c5`）复现：`cold` 与 `hot` 运行成功，`swap` 运行在 pnpm 报告 `link:` 安装成功之后失败，错误为 `ENOENT: no such file or directory, lstat '<profile>/vendor'`。

根因：Node 的持久化 realpath 缓存保留了旧包目录的 `安装目录 → realpath` 条目。bundle 被移除并以 `link:` 包重新安装后，新包入口仍按旧的 profile 拼写求值，于是包内相对的 `vendor` 符号链接解析到 `<profile>/vendor`——profile 中并不存在的路径——而不是 link 目标内部的 `vendor` 目录。失败栈帧是 Node 自己的 `ModuleLoader.resolveSync` → `finalizeResolution` → `realpathSync`，这正是错误指向一个 profile 从未包含过的路径的原因。

修复位于分支 `fix/hmr-purge-stale-realpath-cache`：HMR 使某个 package manifest 失效时，除了已经清理的 ESM `ResolveCache` 与 CommonJS `_pathCache` 外，还会清理该包目录之下的 Node native realpath 缓存条目。Node 26 提供所需 helper（`internal/modules/helpers` 的 `purgeRealpathCacheForPrefix`）；Node 24 没有该 helper，失效行为保持不变，因此该改动在 Node 24 上不产生作用。

证据：加上修复后，同一个 `swap` 复现以 exit 0 结束，报告 `application: applied` 且嵌套 vendor 标记正常加载；HMR 测试在 Node 26.12.1 与 Node 24.22.3 上均为 241 个通过，`package-manifest.ts` 的语句、分支、函数、行覆盖率在两个版本上都是 100%。负对照：把 `package-manifest.ts` 还原到 `master` 后，新测试因 purge 从未被调用而失败。

本次改动没有覆盖的一个边界：Node 24 各自保留了自己的持久化 realpath 缓存——`internal/modules/helpers` 一个、`internal/modules/esm/resolve` 一个——并且没有导出清理接口，因此同样的“目录换成 link”场景在 Node 24 上仍会通过旧目录解析。Node 26 把两个缓存合并到 `purgeRealpathCacheForPrefix` 之后，本次改动调用的正是它。清理 Node 24 的两个私有缓存意味着捕获 `fs.realpathSync` 内部收到的缓存对象，这比本次改动大得多，我们不想在没有讨论的情况下落地，因此把它记在包 README 的已知限制里，并愿意为此补一个后续 PR。

一个有意保留的边界：清理范围限定在被失效的包目录，与既有 manifest 失效的作用范围一致。其他目录的缓存条目仍由 Node 自身的过期机制处理，因为更宽泛的清理会逐出 HMR 实例并不拥有的解析状态。
