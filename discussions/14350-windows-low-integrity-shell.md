<!--
状态：草稿，未发布。
用途：Discussion #14350 的回复正文，供作者过目后决定是否发布（纯分析回复，无代码改动）。
说明：Windows-only 症状，本机无法复现或验证；以下为基于上游 master（4b399c39a6）及 0.2.1-rc.5 / 0.2.2-rc.5 标签的逐层代码核查。
-->

# English reply (for posting to Discussion #14350)

I checked every layer that could lower a child's token on current `master` and across the two versions you name, and the tree contradicts the assumption that the shell executor or the sandbox seam applied the Low label under `danger-full-access`. The evidence suggests the token was inherited, not assigned.

**What is verified in code**

- `danger-full-access` bypasses confinement before any runner is chosen: `bash-sandbox/src/index.ts:92` and `pwsh-sandbox/src/index.ts:99` return the unconfined execution for that mode. This bypass is **byte-identical across `dsh-v0.2.1-rc.5`, `dsh-v0.2.2-rc.5`, and `master`** — the path the report calls a regression did not change.
- Ordinary Windows children carry the current token: the subprocess provider spawns through the Win32 Job runner (`CreateProcessW` + job assignment), which never touches integrity. `win32-process` is likewise unchanged between the two versions.
- The **only** code that produces a Low-integrity token lives inside the confined `windows-acl` runner: `sandbox-windows-acl/src/token.ts` (`CreateRestrictedToken` + `SetTokenInformation`, S-1-16-4096) — and that runner's argv contract accepts only `read-only` / `workspace-write` (`src/runner.ts:103`). It cannot be entered under `danger-full-access`.
- `buildLowLabelAcl` (the symbol in the report) is a **no-write-up mandatory ACE stamped on granted objects** so that already-Low writers can write them. It labels files, never processes — it cannot be the origin of a Low child token. It is, however, consistent with the fix direction: it exists precisely so confined children *can* write where they are allowed to.

**What this leaves**

If every child shows Low while no code path assigns it, the remaining explanations are outside the spawn chain:

1. **The Desktop Host itself was running at Low integrity**, so every descendant inherited it. Nothing in the desktop launch code lowers it — but the installer/updater, AV/EDR policy, an AppLocker/WDAC policy, or a shortcut/launcher attribute can. The 0.2.1→0.2.2 "regression" could then be a packaging or system-policy coincidence, since the spawn-path code is identical.
2. **A confiner was in fact entered** for reasons outside the preset (a per-session or deployment-level override feeding a confined `SandboxExecutionPolicy` independent of the logged preset events).

**To discriminate, check the surviving evidence rather than the token alone:**

- If the token was assigned by the ACL runner, the runner always prints `windows-acl-run: <detail>` on stderr and grants carry `S-1-4-*` workspace write SIDs; a session at `danger-full-access` produces **no** runner line at all. Absence of that signature rules out the confined path entirely.
- `whoami /groups` inside the *Desktop Host process* (e.g. via `handle.exe`/`Process Explorer` on the Electron node process, or `icacls` on `%TEMP%` from a child of the shell host's parent chain) tells whether the Host's own token is Low — direct proof for hypothesis 1.
- `GetTokenInformation(TokenIntegrityLevel)` on the Job runner process vs. its parent pins the hop where the level dropped.

My read: hypothesis 1 fits all four observations (writes denied at Medium, LocalLow writes succeed, reads fine, identical code across versions). If that checks out, the actionable item is on the packaging/launch side rather than the spawn tree — worth confirming before any sandbox code changes.

# 中文对照（仅供作者阅读，不发布）

我逐层核查了 master 以及你点名的两个版本里所有可能降低子进程令牌的代码，结论与「shell 执行器或 sandbox 接缝在 `danger-full-access` 下施加了 Low 标签」的假设不符——证据指向令牌是**继承**来的，不是**指派**的。

**代码层面已证实的事实**

- `danger-full-access` 在选择任何 runner 之前就绕过 confinement：`bash-sandbox/src/index.ts:92` 与 `pwsh-sandbox/src/index.ts:99` 对该模式直接返回非受限执行。这段分支在 `dsh-v0.2.1-rc.5`、`dsh-v0.2.2-rc.5` 与 `master` 上**逐字节相同**——报告称回归的路径没有变过。
- 普通 Windows 子进程携带当前令牌：subprocess 提供方经 Win32 Job runner 启动（`CreateProcessW` + Job 指派），完全不碰完整性级别；`win32-process` 在两个版本间同样无差异。
- **唯一**产生 Low 令牌的代码在受限 `windows-acl` runner 内：`sandbox-windows-acl/src/token.ts`（`CreateRestrictedToken` + `SetTokenInformation`，S-1-16-4096）——而该 runner 的 argv 契约只接受 `read-only` / `workspace-write`（`src/runner.ts:103`），`danger-full-access` 下不可能进入。
- 报告点名的 `buildLowLabelAcl` 是**贴在已授权对象上的 no-write-up 强制性 ACE**，让已经是 Low 的写者能够写入——它标记文件，不标记进程，不可能是 Low 子令牌的来源。它恰好印证修复方向：它存在的意义就是让受限子进程在获准处**能**写。

**剩下的可能**

如果每个子进程都是 Low 而没有任何代码路径指派它，解释就落在 spawn 链之外：

1. **Desktop Host 进程本身就是 Low integrity**，所有子孙继承它。桌面启动代码不降权——但安装器/更新器、AV/EDR 策略、AppLocker/WDAC 策略或快捷方式/启动器属性都可以。由于 spawn 代码在两版本间逐字节相同，0.2.1→0.2.2 的「回归」可能是打包或系统策略的巧合。
2. **确有 confiner 被进入**——出于 preset 之外的原因（会话级或部署级覆盖提供了受限 `SandboxExecutionPolicy`，独立于已记录的 preset 事件）。

**区分方法**：看存留证据而非只看令牌——

- 若令牌由 ACL runner 指派，runner 每次运行都会在 stderr 打印 `windows-acl-run: <detail>`，且授权对象上会有 `S-1-4-*` 工作区写 SID；`danger-full-access` 的会话**不会**产生任何 runner 行。该签名缺席即可排除受限路径。
- 在 Desktop Host 进程上跑 `whoami /groups`（或用 Process Explorer / `icacls` 从宿主父链下探）即可直接验证 Host 自身令牌是否 Low——假设 1 的直接证据。
- 对 Job runner 进程与其父进程分别取 `TokenIntegrityLevel`，可定位级别掉在哪一跳。

我的判断：假设 1 能同时解释全部四个观察（Medium 拒绝写、LocalLow 能写、读正常、两版本代码相同）。若证实，可执行项在打包/启动侧而非 spawn 树——建议在动 sandbox 代码之前先确认这一点。
