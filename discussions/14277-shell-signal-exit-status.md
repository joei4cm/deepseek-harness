<!--
状态：草稿，未发布。
用途：Discussion #14277 的回复正文，供作者过目后决定是否发布。
目标渠道：上游仓库的 Discussions（上游 CONTRIBUTING 声明不接受外部 PR、Issues 已关闭，Discussions 是唯一被认可的反馈渠道）。
说明：本仓库是 fork；提案 1 已在分支 fix/shell-signal-exit-status-posix-code 上实现，未向上游开 PR；提案 2（stdout/stderr 按到达顺序交织）为分析，未附改动，因为交织要求重做 subprocess 层的输出模型。
-->

# English reply (for posting to Discussion #14277)

Both observations check out from the source, and I have implemented the first proposal on a fork branch.

## Proposal 1 — implemented

The marker is rendered in `dsh-tool-bash` and `dsh-tool-pwsh` (the deliberate twin), and both pushed only the signal name:

```ts
if (result.signal !== null) {
  markers.push(`[killed by signal: ${result.signal}]`)
}
```

The missing number is not new information for the process — the platform already knows it. `os.constants.signals` carries a number for every POSIX signal name, and the shell seam already owns the exit-status marker contract that both tools and the host presenters share. So the conversion belongs there, once, rather than in each renderer.

What I implemented on `fix/shell-signal-exit-status-posix-code` (based on `dsh-v0.2.3-alpha.2`):

- `@deepseek-ai/dsh-shell` gains `signalExitStatus(signal)`, which recovers the conventional `128 + signum` status from the platform's signal table — `SIGKILL` → 137, `SIGTERM` → 143, `SIGINT` → 130, `SIGHUP` → 129. A name the platform does not number returns no status, so an unknown signal is never guessed at.
- Both renderers append it to the killed marker, exactly in the shape you proposed:

```text
[killed by signal: SIGKILL (exit code: 137)]
```

- The signal name stays in the marker, so a signal death remains distinguishable from a plain `exit 137` — which is what makes the marker worth having in the first place.
- The exit-status parsers strip the parenthesized status before handing the signal back. The host `parseExitStatus` and the Web terminal-card model's mirrored parser both do this, so the terminal card still shows a `SIGKILL` pill and no UI changes at all. The annotation is only visible in the model-facing text, which is where it was missing.
- A signal the platform cannot number keeps the previous marker shape (`[killed by signal: SIGHIPPO]`), so the degradation path is explicit rather than a wrong number.

**On the structured exit metadata.** You also noted that the status is missing from the structured exit metadata, not only from the marker. There, `ShellRunResult.exitCode` is `null` for a signal kill and `signal` is a separate field — the seam documents that meaning explicitly ("Exit code once finished (null = killed by signal / still running)"). Filling `exitCode` with 137 would erase the distinction between "killed by SIGKILL" and "exited 137" in the structured field, so I left that field alone: the model can only read the tool-result text, so the marker was where the status was actually missing for an agent auditing a run. If you want the structured field to carry it too, the honest shape is a separate field (a `signalStatus` next to `exitCode: null`, or a dedicated `exitStatus`), because reusing `exitCode` collapses two different facts into one. That is a seam API decision, so I did not make it unilaterally.

## Proposal 2 — analysis only

The two streams are separate pipes today. `packages/subprocess/subprocess-local/src/spawn.ts` launches with `stdio: [stdin, 'pipe' | 'inherit', 'pipe' | 'inherit']`, and each pipe gets its own `OutputCollector` — its own in-memory tail window and its own spill file. The `SubprocessCollect` seam exposes separate `stdout` and `stderr` collectors, and `ShellRunResult` reports the two streams separately, each with its own `truncated` flag and `spillPath`.

Chronological interleaving therefore cannot be a bash-rendering change: it needs stdout and stderr to share one file descriptor (`stdio: ['ignore', fd, fd]`), which is a subprocess-layer redesign. Two things make that more than a mechanical change:

- The tail window is load-bearing for background consumers. `readOutput()` is consuming and offset-based, and the background job registry's pull sources read deltas from the same captured streams. A single merged collector has to answer "which stream did this byte come from" per chunk and keep two cursors over one stream, or the incremental reads return gaps.
- The ordering is only useful if it is captured at arrival, not at assembly. So even with one fd, the useful form is a tagged chunk stream — stderr lines tagged inline, in arrival order — which is the second option you listed. That is a new output model for the subprocess seam, not a formatting tweak.

Two shapes I would put to the maintainers, in order of how much they preserve:

1. **Keep the separate streams, add arrival-ordered metadata.** The collector emits tagged chunks (`stream`, `text`) as they arrive, and the tool renders stdout and stderr from that ordered log. The tail window and the spill file stay per-stream, so the background read cursors and the existing result shape are untouched; only the ordering metadata is new.
2. **Share one fd and treat the output as one tagged stream.** Cheapest ordering, but it reworks `SubprocessCollect`, `ShellRunResult`, and the background read cursors together.

I have not implemented either: which shape the subprocess seam should take is a maintainer call, and it is a much larger change than proposal 1 — I would rather raise it as its own design discussion than attach it to a one-line marker fix.

I cannot run your TraceTrial-Bench A/B myself, but if you do once an RC is available I would be glad to read the numbers. The branch is on my fork; I have not opened a pull request, since `CONTRIBUTING.md` states that external pull requests are not accepted — happy to hand over the branch, a patch, or a diff in whatever form is useful.

# 中文对照（仅供作者阅读，不发布）

两项观察都能从源码证实，第 1 项提案我已在 fork 分支上实现。

## 提案 1，已实现

marker 在 `dsh-tool-bash` 与 `dsh-tool-pwsh`（deliberate twin）里渲染，两边都只推入了信号名：

```ts
if (result.signal !== null) {
  markers.push(`[killed by signal: ${result.signal}]`)
}
```

缺失的数字对进程来说并不是新信息——平台本来就知道。`os.constants.signals` 给出每个 POSIX 信号名对应的号码，而 shell 接缝本来就拥有 bash/pwsh 工具与宿主 presenter 共享的退出状态 marker 契约。所以这次换算应当放在那里，只做一次，而不是在每个渲染器里各写一遍。

我在 `fix/shell-signal-exit-status-posix-code`（基于 `dsh-v0.2.3-alpha.2`）上实现的内容：

- `@deepseek-ai/dsh-shell` 新增 `signalExitStatus(signal)`，从平台的信号表恢复约定的 `128 + signum` 状态——`SIGKILL` → 137、`SIGTERM` → 143、`SIGINT` → 130、`SIGHUP` → 129。平台没有编号的名字不返回状态，绝不猜测未知信号。
- 两个渲染器把状态追加到被杀 marker 上，形状与你提议的完全一致：

```text
[killed by signal: SIGKILL (exit code: 137)]
```

- 信号名仍留在 marker 里，所以「被信号杀死」与「普通 `exit 137`」依旧可区分——这正是这个 marker 存在的意义。
- 退出状态解析器在交出信号名前剥离括号状态。宿主的 `parseExitStatus` 与 Web 终端卡片模型里镜像的解析器都这样做，所以终端卡片仍显示 `SIGKILL` pill，UI 毫无变化。注解只出现在模型可见的文本里——那才是真正缺它的地方。
- 平台无法编号的信号保持原 marker 形态（`[killed by signal: SIGHIPPO]`），降级路径是显式的，而不是给出一个错数字。

**关于结构化退出元数据。** 你也提到这个状态不只缺在 marker 里，结构化退出元数据里同样没有。结构化侧的事实是：`ShellRunResult.exitCode` 在被信号杀死时为 `null`，`signal` 单列——接缝明确写了这个语义（"Exit code once finished (null = killed by signal / still running)"）。把 `exitCode` 填成 137 会让「被 SIGKILL 杀死」与「以 137 退出」在结构化字段上不可区分，所以我没有动那个字段：模型能读到的只有工具结果文本，对一个审计运行结果的 agent 来说，缺状态的地方正是 marker。若你希望结构化字段也带上它，诚实的形状是新增一个独立字段（`exitCode: null` 旁边的 `signalStatus`，或专门的 `exitStatus`），因为复用 `exitCode` 会把两个不同的事实压成一个。那是接缝的 API 决策，我没有擅自决定。

## 提案 2，仅分析

今天两个流是分开的管道。`packages/subprocess/subprocess-local/src/spawn.ts` 以 `stdio: [stdin, 'pipe' | 'inherit', 'pipe' | 'inherit']` 启动，每个管道各有自己的 `OutputCollector`——各自的内存尾部窗口、各自的 spill 文件。`SubprocessCollect` 接缝分别暴露 `stdout` 与 `stderr` 收集器，`ShellRunResult` 也分别报告两个流，各带自己的 `truncated` 标志与 `spillPath`。

因此按到达顺序交织不可能是 bash 渲染层的改动：它需要 stdout 与 stderr 共享同一个文件描述符（`stdio: ['ignore', fd, fd]`），属于 subprocess 层的重新设计。有两点让这件事超出机械修改：

- 尾部窗口对后台消费者是承重的。`readOutput()` 是 consuming 且基于偏移的，后台作业注册表的 pull 源也从同一批捕获流里读增量。合并成一个收集器后，它必须逐块回答「这些字节来自哪个流」并在一个流上维护两个游标，否则增量读会返回缺口。
- 顺序只有在**到达时**捕获才有意义，组装时再拼就晚了。所以即便共享 fd，有用的形态也是带标签的块流——stderr 行内联标记、保持到达顺序——也就是你列出的第二个选项。那是 subprocess 接缝的新输出模型，不是格式微调。

我会提给维护者的两种形状，按保留现有语义多少排序：

1. **保持两个流独立，增加到达顺序元数据。** 收集器在数据到达时发出带标签的块（`stream`、`text`），工具按这份有序日志渲染 stdout 与 stderr。尾部窗口与 spill 文件仍按流独立，后台读游标与现有结果形状都不动，新增的只是顺序元数据。
2. **共享一个 fd，把输出当作一条带标签的流。** 顺序最省事，但要把 `SubprocessCollect`、`ShellRunResult` 与后台读游标一起重做。

两者我都没有实现：subprocess 接缝该取哪种形态是维护者的决定，而且比提案 1 大得多——我更愿意把它作为独立的设计讨论提出来，而不是挂在一个一行的 marker 修复上。

我没法自己跑你们的 TraceTrial-Bench A/B，但等有 RC 时如果你们跑了一次，我很乐意看数字。分支在我的 fork 上；我没有开 PR，因为 `CONTRIBUTING.md` 声明不接受外部 PR——需要的话我可以交出分支、patch 或 diff，任何形式都可以。
