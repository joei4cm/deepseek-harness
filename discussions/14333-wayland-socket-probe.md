<!--
状态：草稿，未发布。
用途：Discussion #14333 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/native-command-wayland-socket-probe` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（8bd073392e）；报告的证据链与 path-opener.ts 判据在当前代码树逐条核对过。
-->

# English reply (for posting to Discussion #14333)

Your evidence chain checks out on current `master`: `canOpenNativePath()` (`packages/util/native-command/src/path-opener.ts:215` on master) answers Linux from `WSL_DISTRO_NAME`/`WSL_INTEROP`/kernel release, `DISPLAY`, and `WAYLAND_DISPLAY` only. A systemd user service inherits none of the display variables but does inherit `$XDG_RUNTIME_DIR` — where the live desktop session publishes its compositor socket, which is exactly the discovery `xdg-open` performs when the variables are absent. So the availability check contradicts what the opener itself would find, and `GET /api/present.host` hides the open buttons per request.

I implemented the socket probe from your option 1 on a fork branch (`fix/native-command-wayland-socket-probe`, based on upstream `master`):

- **Linux now also counts a live `wayland-<n>` socket under `$XDG_RUNTIME_DIR` as a desktop.** The socket is the same evidence `xdg-open`'s own discovery uses, so the availability answer tracks the opener's actual reach rather than an environment announcement. A `wayland-0.lock` companion or unrelated entries don't count, and a missing, unreadable, or socketless runtime directory keeps the answer false — a genuinely headless server still reports no desktop, and so does an SSH login without a running session (the runtime directory exists there, the socket doesn't).
- I deliberately skipped your option 3 (invert the default and expose per-gesture failures): it is the most robust end state, but it moves the behavior into the deliverable card's GUI paths (hidden control vs. per-click `422 → nativeUnavailable`), which deserves its own product-side pass; the socket probe fixes your scenario entirely server-side with a one-seam diff. Option 2 (portal reachability) needs a D-Bus round trip inside a synchronous check; option 4 (re-read on focus) is a client-refresh improvement worth its own change — the host endpoint is already computed per request, so nothing is cached on the host side today.
- The check stays synchronous: the probe is one `readdir` of `$XDG_RUNTIME_DIR`, injected as a test seam (`PathOpenerInternals.readDir`) next to the existing platform/env seams.

The regression tests cover the reporter scenario and the headless boundaries — socket present → true; only a lock file, unrelated entries, missing or unreadable directory → false; existing `DISPLAY`/`WAYLAND_DISPLAY`/WSL criteria unchanged. I also replayed your reproduction steps live on a Linux desktop machine: with `DISPLAY` and `WAYLAND_DISPLAY` scrubbed from the environment and `wayland-0` present under `$XDG_RUNTIME_DIR`, `canOpenNativePath()` now answers true, and answers false with no runtime directory. Package suite, typecheck, lint, build, and the doc gates pass; the branch and a full pull-request description are ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

# 中文对照（仅供作者阅读，不发布）

你的证据链在当前 master 上成立：`canOpenNativePath()`（master 的 `packages/util/native-command/src/path-opener.ts:215`）对 Linux 只看 `WSL_DISTRO_NAME`/`WSL_INTEROP`/内核版本、`DISPLAY`、`WAYLAND_DISPLAY`。systemd 用户级服务继承不到任何显示变量，但继承了 `$XDG_RUNTIME_DIR`——活的桌面会话把合成器 socket 发布在那里，而这正是 `xdg-open` 在变量缺席时自己做的探测。可用性判定于是与打开器自身的实际可达性相矛盾，`GET /api/present.host` 因此逐请求隐藏打开按钮。

我把你方案 1 的 socket 探测实现在 fork 分支（`fix/native-command-wayland-socket-probe`，基于上游 master）：

- **Linux 现在把 `$XDG_RUNTIME_DIR` 下存活的 `wayland-<n>` socket 也算作桌面。** 这个 socket 就是 `xdg-open` 自己探测所依赖的证据，可用性回答因此跟随打开器的实际可达性，而不是环境变量的「宣告」。`wayland-0.lock` 伴生文件与无关条目不算；runtime 目录缺失、不可读或无 socket 保持 false——纯 headless 服务器仍然报告无桌面，无图形会话的 SSH 登录也一样（目录在、socket 不在）。
- 我刻意跳过了你的方案 3（反转默认值、按次暴露失败）：那是最终态的正确方向，但它把行为推进交付卡片的 GUI 路径（隐藏控件 vs 每次点击 `422 → nativeUnavailable`），值得单独走一轮产品侧评审；socket 探测以单缝隙 diff 在服务端完整修好你的场景。方案 2（portal 可达性）要在同步判定里做 D-Bus 往返；方案 4（焦点时重读）是值得独立成项的客户端刷新改进——宿主端点本来就是每请求现算的，宿主侧今天没有缓存。
- 判定保持同步：探测只是对 `$XDG_RUNTIME_DIR` 的一次 readdir，以测试缝隙（`PathOpenerInternals.readDir`）注入，与既有 platform/env 缝隙并列。

回归测试覆盖报告者场景与 headless 边界——socket 存在 → true；只有 lock 文件、无关条目、目录缺失或不可读 → false；既有 `DISPLAY`/`WAYLAND_DISPLAY`/WSL 判据不变。我还在一台 Linux 桌面机器上活体重演了你的复现步骤：从环境中清除 `DISPLAY` 与 `WAYLAND_DISPLAY`、`$XDG_RUNTIME_DIR` 下有 `wayland-0` 时，`canOpenNativePath()` 现在回答 true；无 runtime 目录时回答 false。包套件、typecheck、lint、build、doc 门禁通过；分支与完整 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。
