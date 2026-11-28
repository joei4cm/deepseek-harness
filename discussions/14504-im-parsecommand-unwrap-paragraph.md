# #14504 — IM slash commands fail because `parseCommand` does not unwrap `<p>` (draft, unpublished)

Status: the one-line takeover claim was published upstream (discussioncomment-19982413); no substantive reply has been published, because the permission classifier denies substantive technical comments on upstream discussions. This reply stays an unpublished draft until the user authorizes posting for #14504 specifically.

## English

Thanks for the clear root-cause report and repro — we took it (claim above) and landed a narrow fix on branch `fix/im-parsecommand-unwrap-paragraph` (based on upstream `master` `841f76d3c5`).

Root cause matches your diagnosis verbatim: every IM adapter (`adapter-qq`, `adapter-lark`) passes inbound content through `@deepseek-ai/satori-element`'s `normalize()`, which wraps bare inline runs into `<p>` blocks, while `parseCommand` in `packages/experimental/im/src/intake.ts` only inspected direct children of `<message>` and returned `undefined` whenever the first child was `<p>`. The existing test fixtures constructed unnormalized `h('message', h.text(...))` directly, so the unit suite missed it.

Fix: `parseCommand` unwraps a leading `<p>` block while keeping compatibility with unnormalized direct-child `<message>` trees. One small refinement over the suggested snippet: when additional blocks follow the leading `<p>` (for example `<p>/compact</p><p>keep this</p>`), they are joined onto `rawInput` with `\n` (matching `toText()`'s block separator) rather than concatenated directly onto the end of the first paragraph. Without that separator, `im-session-commands` forwards `/${name}${rawInput}` as `/compactkeep this` to `ctx.commands.execute`, which rejects it because `dsh-commands` requires whitespace or end-of-text after the command name. An empty trailing block still leaves `rawInput` as `""`.

Evidence: `packages/experimental/im` and `packages/experimental/im-session-commands` pass all 16 test files / 437 tests (including new `normalize()` unit cases and an end-to-end `im-session-commands` case for `/help` and multi-paragraph `/compact`), with `packages/experimental/im/src/intake.ts` at 100% statement, branch, function, and line coverage (276/276, 186/186, 62/62, 230/230). Negative control: reverting `parseCommand` to `origin/master` makes both new tests fail (`parseCommand(normalize(h.text('/help')))` returns `undefined` and `im-session-commands` returns `{ kind: 'ignored' }`).

## 中文

感谢清晰的根因定位与复现——我们已经接手（见上方声明），并在分支 `fix/im-parsecommand-unwrap-paragraph`（基于 upstream `master` `841f76d3c5`）上落地了窄修复。

根因与报告完全一致：所有 IM 适配器（`adapter-qq`、`adapter-lark`）都会把入站内容经过 `@deepseek-ai/satori-element` 的 `normalize()`，把行内文本包进 `<p>` 块；而 `packages/experimental/im/src/intake.ts` 的 `parseCommand` 只检查 `<message>` 的直接子节点，遇到 `<p>` 直接返回 `undefined`。原有测试夹具直接构造未经过 `normalize()` 的 `h('message', h.text(...))`，因此单测没有覆盖到。

修复：`parseCommand` 在首子节点为 `<p>` 时穿透该段落查找命令，同时保留对未包裹直出 `<message>` 的兼容。相对建议补丁有一处小调整：首个 `<p>` 之后如果还有其他块（例如 `<p>/compact</p><p>keep this</p>`），改为以 `\n` 拼接进 `rawInput`（与 `toText()` 的块分隔符一致），而不是直接拼接在首段之后。若不加分隔符，`im-session-commands` 转发给 `ctx.commands.execute` 的 `/${name}${rawInput}` 会变成 `/compactkeep this`，`dsh-commands` 会因命令名后缺少空白边界而拒收。首段之后为空块时 `rawInput` 仍保持 `""`。

证据：`packages/experimental/im` 与 `packages/experimental/im-session-commands` 共 16 个测试文件 / 437 个测试全部通过（包含新增的 `normalize()` 单测以及 `im-session-commands` 对 `/help` 与多段 `/compact` 的端到端用例），`packages/experimental/im/src/intake.ts` 保持语句、分支、函数、行覆盖率 100%（276/276、186/186、62/62、230/230）。负对照：将 `parseCommand` 还原为 `origin/master` 后，两个新用例均失败（`parseCommand(normalize(h.text('/help')))` 返回 `undefined`，`im-session-commands` 返回 `{ kind: 'ignored' }`）。
