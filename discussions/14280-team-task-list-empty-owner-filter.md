<!--
状态：草稿，未发布。
用途：Discussion #14280 的回复正文，供作者过目后决定是否发布。
目标渠道：上游仓库的 Discussions（上游 CONTRIBUTING 声明不接受外部 PR、Issues 已关闭，Discussions 是唯一被认可的反馈渠道）。
说明：本仓库是 fork，改动在分支 `fix/team-task-list-empty-owner-filter` 上，未向上游开 PR。
-->

# English reply (for posting to Discussion #14280)

Confirmed on `master`, and the report's reproduction is exact. One more detail turned up while tracing it, because it changes why the fix should be normalization rather than just reordering the guard:

- `{"owner": "", "unowned": true}` fails with `owner and unowned filters cannot be combined`, exactly as reported — the mutual-exclusion guard runs before any normalization.
- `{"owner": ""}` alone does not fail. It reaches `resolveName(caller, '')`, and because `resolveName` returns any slash-free token it cannot resolve as a Session id, the empty string is branded into an empty Session id. The filter becomes `task.ownerId === ''` and the call silently returns zero tasks. That is the worse half of the same hole: no error at all, just an empty board.

The schema-level alternative (`minLength: 1`) is not available here — the tool-parameter DSL only supports `type`, `enum`, and `const` on strings — so the fix lands where the decision is made, in `team_task_list.execute`:

```ts
const ownerName = args.owner === undefined || args.owner.trim() === '' ? undefined : args.owner.trim()
if (ownerName !== undefined && args.unowned !== undefined) throw new ToolArgsError(['owner and unowned filters cannot be combined'])
const owner = ownerName === undefined ? undefined : await ctx.subagents.resolveName(caller, ownerName, exec.signal)
```

So an empty or whitespace-only `owner` behaves like an omitted filter, a real name with surrounding whitespace still resolves, and a real name combined with `unowned` still fails loud. The regression test covers all four cases; per-file coverage for the package stays at 100%.

One scope question for the maintainers: `team_task_update` (the `reassign` action) resolves its `owner` through the same `resolveName` call, and an empty string there silently assigns the task to a nonexistent empty owner. The documented semantics of that parameter is "omit to unassign", so normalizing empty to omitted would make `owner: ""` a silent unassign — a write, not a read. I left that path untouched deliberately. Should it reject the empty string loud, or normalize it to an unassign? Happy to send that as a follow-up either way.

A branch with the change is on my fork (`fix/team-task-list-empty-owner-filter`, based on `dsh-v0.2.3-alpha.2`). I have not opened a pull request, since `CONTRIBUTING.md` states that external pull requests are not accepted — happy to hand over the branch, a patch, or a diff in whatever form is useful to you.

# 中文对照（仅供作者阅读，不发布）

在 `master` 上确认，报告的复现完全准确。排查时多发现一层——这一层决定了修法必须是归一化而不只是把守卫换个位置：

- `{"owner": "", "unowned": true}` 按报告报错 `owner and unowned filters cannot be combined`——互斥守卫在任何归一化之前运行。
- `{"owner": ""}` 单独传入时不报错。它到达 `resolveName(caller, '')`，而 `resolveName` 会把无法解析且不含 `/` 的 token 原样当 Session id 返回，空字符串于是被 branded 成空 Session id，过滤条件变成 `task.ownerId === ''`，调用**静默返回零任务**。这是同一个洞更糟的一半：没有任何报错，只有一块空任务板。

协议层替代方案（`minLength: 1`）在此不可用——工具参数 DSL 的字符串规格只支持 `type`、`enum`、`const`——所以修复落在做决定的地方，即 `team_task_list.execute`（代码同上）。

行为：空或全空白的 `owner` 视为未提供该过滤；真实名称裁剪首尾空白后照常解析；真实名称与 `unowned` 同传仍然响亮报错。回归测试覆盖四种情形；包逐文件覆盖率保持 100%。

留给维护者的范围问题：`team_task_update`（`reassign` 动作）经同一个 `resolveName` 解析 `owner`，空字符串会静默把任务挂到一个不存在的空 owner 上。该参数的文档语义是「省略即 unassign」，所以归一化为「省略」会让 `owner: ""` 变成一次静默 unassign——这是写操作，不是读。我有意未动这条路径。它应该响亮拒绝空字符串，还是归一化为 unassign？两种方向我都愿意作为后续提交。

改动在 fork 的分支 `fix/team-task-list-empty-owner-filter`（基于 `dsh-v0.2.3-alpha.2`）上。由于 `CONTRIBUTING.md` 声明不接受外部 PR，我没有开 PR——需要的话我可以以分支、patch 或 diff 的形式交付。
