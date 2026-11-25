<!--
状态：草稿，未发布。
用途：Discussion #14307 的回复正文，供作者过目后决定是否发布。
说明：修复位于 fork 的 `fix/subprocess-git-command-line-config` 分支（同一根因早先由 #14242 报告，分支与描述先于本讨论存在），未向上游开 PR。
-->

# English reply (for posting to Discussion #14307)

Thank you for the precise diagnosis — and for catching the plugin-manager connection-check impact, which #14242 (the earlier report of the same root cause) had not covered.

Your evidence chain is correct, and one detail strengthens the case further: in your environment `GIT_CONFIG_VALUE_0` carries the header itself (`http.extraHeader` with an `AUTHORIZATION: bearer …` value). A fix that only deletes `GIT_CONFIG_COUNT` — as sketched in the report — unbreaks git but leaves that credential-shaped value in every child environment. The count has to go with the keys it counts, and the values go with them.

On a fork branch (`fix/subprocess-git-command-line-config`) I implemented the group removal instead:

```ts
const GIT_COMMAND_LINE_CONFIG_NAME = /^GIT_CONFIG_(?:COUNT|PARAMETERS|KEY_\d+|VALUE_\d+)$/i
```

`scrubbedParentEnv()` drops all four names as one atomic group (case-insensitively, matching the existing `DSH_*` scrub), so a child sees either the complete ambient configuration or none of it — no half-group state, and no surviving `VALUE_n` with the header in it. Ordinary `GIT_*` names such as `GIT_TERMINAL_PROMPT` still pass through, and a deliberately forwarded `GIT_CONFIG_*` entry still works because the caller's explicit `env` merges after the scrub. The plugin-manager `git ls-remote` you quoted routes through the same scrub, so it is covered without a change of its own.

Regression tests cover both reported shapes: the full group with a credential-bearing value (asserting the token does not appear in the scrubbed environment), and the half-group you observed — `GIT_CONFIG_COUNT` plus `GIT_CONFIG_VALUE_n` with the key half already stripped. With the group removal reverted, both tests fail deterministically (the counter and the credential value survive), so the tests pin the fix rather than the incident.

One note on the report's sketch: deleting only the count is sufficient for git's parser but not for containment; the half-group tests above fail under that variant for the credential-value assertion specifically.

# 中文对照（仅供作者阅读，不发布）

感谢精确的诊断——尤其抓到了 plugin-manager 连接检查的误伤面，这是同一根因的早先报告 #14242 没有覆盖到的。

你的证据链是对的，而且有一个细节让结论更强：你的现场里 `GIT_CONFIG_VALUE_0` 直接携带请求头本身（`http.extraHeader` 配 `AUTHORIZATION: bearer …`）。只删 `GIT_CONFIG_COUNT` 的修法（报告里草拟的那种）能让 git 恢复工作，却把那个形似凭据的值留在每一个子进程的环境里。计数器要跟键一起走，值也要跟它们一起走。

在 fork 分支（`fix/subprocess-git-command-line-config`）上实现的是整组移除：

```ts
const GIT_COMMAND_LINE_CONFIG_NAME = /^GIT_CONFIG_(?:COUNT|PARAMETERS|KEY_\d+|VALUE_\d+)$/i
```

`scrubbedParentEnv()` 把四个名字视作一个原子组整体移除（与既有 `DSH_*` 清洗一样大小写不敏感），子进程要么看到完整的环境配置组，要么完全看不到——不再有半组状态，也不会残留带请求头的 `VALUE_n`。`GIT_TERMINAL_PROMPT` 等普通 `GIT_*` 名字照常保留；调用方显式转发的 `GIT_CONFIG_*` 依然生效，因为显式 `env` 在清洗之后合并。你引用的 plugin-manager `git ls-remote` 走的就是同一个清洗，无需自己的改动就能被覆盖。

回归测试覆盖两种现场形态：完整组且值为凭据头（断言 token 不出现在清洗后的环境里），以及你观察到的半组——只剩 `GIT_CONFIG_COUNT` 加 `GIT_CONFIG_VALUE_n`、键半已被剥。还原组剔除后两条测试都确定性失败（计数器与凭据值残留），因此测试钉住的是修复而不是事故。

对报告草拟方案的一点说明：只删计数器能让 git 的解析器满意，但达不到收容目的；上面两条测试在那一变体下会专门因凭据值断言而失败。
