<!--
状态：草稿，未发布。
用途：Discussion #14319 的回复正文，供作者过目后决定是否发布。
说明：无对应 fork 分支 — 本地全场景复现失败，给出可核实的机制分析，供上游核对泄漏是否发生在打包产物自带 Node / mux 层。
-->

# English reply (for posting to Discussion #14319)

Thank you for the thorough report — the socket-state evidence is convincing. I tried to reproduce the leaked-socket symptom on the current tree and could not, which narrows where the leak must live; sharing the analysis in case it helps isolate the culprit layer.

On Node v24.22.3 (same runtime line you report), none of the early-reject paths you list leaks a socket in my loopback experiments:

- `res.writeHead(4xx); res.end()` without reading the body, then client `SHUT_WR` → socket closes cleanly for bodies from 4 B to 4 MiB. `llhttp` completes the request at peer EOF and the server FINs.
- Same with the client socket left open (no FIN): at `res` `'finish'` the request stream is already `readableFlowing === true` — Node drains the remaining body by itself, so the connection stays usable for keep-alive.
- Pipelined second request after an unread body, `Expect: 100-continue` with the body never sent, truncated `Transfer-Encoding: chunked`, and a `req.pause()` left in place all close correctly.
- The single-point fix you suggest (`res.once('finish', () => { if (!req.readableEnded && !req.destroyed) req.resume() })`) is therefore a no-op on this Node: `resume()` on an already-flowing stream does nothing, and the kernel Recv-Q is already empty.

So on upstream's current source + Node v24, draining happens inside the runtime, and a `net`-level CLOSE-WAIT with non-zero `Recv-Q` should not be reachable through the paths listed. Two consequences worth checking on your deployment:

1. **Which sockets leak.** If the leaked connections sit behind the `/api/remote.mux` WebSocket or another upgraded channel rather than plain HTTP requests, their "requests" are streams muxed onto one real socket — the per-request body is never a kernel Recv-Q problem to begin with, and the stuck state would live in the mux, not the HTTP layer. `ss -tnp` on the muxed socket would look exactly like a CLOSE-WAIT with unread bytes.
2. **Which Node the bundle runs.** The shipped tarball may link a different Node than the one on the box. If `dsh` is launched as a packaged binary or through Electron, its embedded runtime is what parses HTTP — checking `process.version` inside the running process (or the binary's Node build) is more reliable than the system `node -v`.

If either check lands on the bundled runtime, the fix is still your listener-level drain — it is correct and harmless on every Node (a `resume()` on a completed stream costs nothing), it just cannot be the layer producing the symptom on current upstream. If you can share the `ss` output around a hang (remote address, Recv-Q trend) and the result of `process.version` inside the server process, that would pin the leaking layer definitively.

# 中文对照（仅供作者阅读，不发布）

感谢详尽的报告——socket 状态证据很有说服力。我在当前代码树上尝试重现泄漏 socket 但失败了，这反而收窄了泄漏所在层；分享该分析以帮助定位罪魁。

在 Node v24.22.3（与你报告相同的运行时线）上，你列出的早退路径在我的回环实验中都不泄漏 socket：

- `res.writeHead(4xx); res.end()` 不读 body，随后客户端 `SHUT_WR` → 4 B 到 4 MiB 的 body 都干净关闭。`llhttp` 在对端 EOF 时补完请求，服务器正常 FIN。
- 客户端不半关闭（不发 FIN）也一样：`res` `'finish'` 时请求流已 `readableFlowing === true`——Node 自己排空剩余 body，keep-alive 连接保持可用。
- 未读 body 后紧跟流水线第二请求、`Expect: 100-continue` body 不发、`Transfer-Encoding: chunked` 截断、以及显式 `req.pause()`，全部正常关闭。
- 你建议的单点修复（`res.once('finish', ...req.resume())`）在此 Node 上因此是 no-op：对已 flowing 的流 `resume()` 无事可做，内核 Recv-Q 早已为空。

所以在上游当前源码 + Node v24 上，drain 由运行时内部完成，`net` 层 CLOSE-WAIT 且 `Recv-Q` 非零在所列路径下不可达。两个值得在你部署上检查的方向：

1. **哪些 socket 在泄漏。** 如果泄漏连接位于 `/api/remote.mux` WebSocket 或其他升级通道而非裸 HTTP 请求，它们的"请求"是多路复用在同一条真实 socket 上的流——每个请求的 body 根本不是内核 Recv-Q 问题，卡死状态在 mux 内部而非 HTTP 层。`ss -tnp` 看到的 mux socket 会恰好表现为带未读字节的 CLOSE-WAIT。
2. **打包产物实际运行的 Node。** 分发的 tarball 可能链接了与系统不同的 Node。如果 `dsh` 以打包二进制或经 Electron 启动，解析 HTTP 的是其内嵌运行时——查看运行进程的 `process.version`（或二进制的 Node 构建）比系统 `node -v` 可靠。

如果两项检查指向打包运行时，你的监听器级 drain 修复仍是正确的：它在所有 Node 上无害（对已完成的流 `resume()` 无开销），只是在当前上游上不可能是产生症状的层。若能分享 hang 时刻的 `ss` 输出（远端地址、Recv-Q 变化趋势）和服务器进程内 `process.version` 的结果，可最终钉住泄漏层。
