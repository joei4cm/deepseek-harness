<!--
状态：草稿，未发布。
用途：Discussion #14358 的回复正文，供作者过目后决定是否发布。
核对基线：上游 master（4b399c39a6）；本地测试使用同一运行时代码。
-->

# English reply (for posting to Discussion #14358)

The reported cross-call redeclaration failure appears to be addressed on current `master` by the scoped REPL introduced in `793ce790a6`, first included in `dsh-v0.2.3-alpha.2`. The report tested `0.2.2-rc.5`, which predates that change.

The Node runtime now defaults to persistent in-memory execution with `replScoped` enabled. In that mode each call has its own top-level scope, and later calls receive copies of earlier bindings. Declaring the same `const` in a later call is allowed; it does not reject that program before execution. The existing runtime regression exercises two calls redeclaring `const value`, checks that the second call's output is produced, and checks that an earlier closure still sees its original value.

This is not full isolation between calls: earlier bindings are copied into later scopes, and objects referenced by those bindings remain shared. The old unscoped REPL is still available when `replScoped: false` is explicitly configured, so this observation applies to the current default rather than every possible configuration. Same-program duplicate declarations remain syntax errors; the scoped evaluator constructs source-position diagnostics for parse failures.

I ran the focused runtime tests for execution-mode selection and cross-call redeclaration: 6 passed, 35 skipped by the filter. This is evidence from the runtime tests, not a reproduction using the reporter's original session or an end-to-end run through `run_code`. It would be useful to retry the original case on a release containing the scoped REPL and report the runtime configuration if it still fails.

# 中文对照（仅供作者阅读，不发布）

当前 `master` 中，`793ce790a6` 引入的 scoped REPL 看起来已经解决了报告中的跨调用重声明失败，首次包含该改动的标签是 `dsh-v0.2.3-alpha.2`。报告测试的 `0.2.2-rc.5` 早于这项改动。

Node 运行时现在默认采用持久内存执行并启用 `replScoped`。在这个模式下，每次调用拥有自己的顶层作用域，后续调用收到先前绑定的副本。在后一次调用中再次声明同名 `const` 是允许的，不会因此在执行前拒绝整个程序。现有运行时回归测试在两次调用中重新声明 `const value`，检查第二次调用确实产出结果，并检查较早的闭包仍读取原来的值。

这并不是调用之间完全隔离：先前绑定会复制到后续作用域，绑定所引用的对象仍然共享。显式配置 `replScoped: false` 仍可使用旧的非 scoped REPL，因此上述结论针对当前默认配置，并不覆盖所有配置。同一个程序内重复声明仍是语法错误；scoped evaluator 会为解析失败构造包含源代码位置的诊断。

本地运行了执行模式选择和跨调用重声明的定向运行时测试：6 项通过，过滤条件跳过 35 项。这是运行时测试的证据，并非使用报告者原始会话复现，也并非经过 `run_code` 的端到端运行。如果包含 scoped REPL 的版本上仍然失败，可以重试原始用例并提供运行时配置。
