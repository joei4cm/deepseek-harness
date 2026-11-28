<!--
Status: draft, not published.
Target: Discussion #6441.
The one-line takeover claim has been published; this draft needs the author's
authorization, and a fresh check for new comments, before anything else is posted.
-->

# Published claim (one line)

我们对照当前 `master`（`4b399c39a6`）接手了这个问题。

# English reply (draft)

Thanks for the three reports — the gdb backtrace through `uv_getnameinfo`, the `scaling_cur_freq` reads on the 192-core host, and the SIGABRT reproduction against a churning proxy are what turned this from "the web UI freezes" into a single-line call site.

We took this on against current `master` (`4b399c39a6`), and we did not add the `excludeNetwork` guard. That guard is the right first half of the fix for the reverse-DNS freeze, but it leaves the other two pathologies untouched: the report's CPU walk still opens every sysfs `scaling_cur_freq` entry (4.4 s on @CherryLemon's host, unchanged with `excludeNetwork` set), and the abort @colehurwitz reproduced happens inside the same handle walk, which `excludeNetwork` does not prevent. Building a diagnostic report is not a cheap way to answer "glibc or musl", so the entry no longer builds one on the normal path.

**What the entry does now.** It reads the C library mapped into the running process from `/proc/self/maps` and loads the addon built for that library. The mapping is the authoritative signal — it is the library the addon will actually be loaded into — and reading it costs about 0.1 ms, against the 2 ms of a report on a quiet 16-core host and the tens of seconds a report costs on the hosts reported here. The report is still consulted, with its network section excluded, only when `/proc` cannot be read at all.

**One rule, three call sites.** The rule now lives in one module in the entry package, and the flock entry, the native build script, the test fixtures, and the repository's local bundle registry all use it. That matters beyond tidiness: the build script decides which variant it compiles and the entry decides which variant it loads, so a rule that lives in two places is a rule that can drift and leave the host with an addon the runtime will not load.

**One judgment call worth flagging.** When a process maps both musl and a glibc compatibility layer's libc, the mapping names musl, and musl wins. That is the library the process is actually using, and it is the variant the addon has to match. It is the one case where the answer can differ from the old one, which read Node's own build instead.

The branch is `fix/flock-linux-libc-probe`, written from this thread; upstream does not accept external pull requests, so the branch sits on our fork: https://github.com/joei4cm/deepseek-harness/tree/fix/flock-linux-libc-probe

# 中文对照（仅供阅读，不发布）

感谢三份报告——穿过 `uv_getnameinfo` 的 gdb 栈、192 核机器上对 `scaling_cur_freq` 的读取、以及对着代理 churn 复现的 SIGABRT，把「Web 界面卡死」收敛到了单行调用点。

我们对照当前 `master`（`4b399c39a6`）接手了这个问题，但没有只加 `excludeNetwork` 保护。那是修掉反向 DNS 冻结的正确第一步，但另外两种病理仍在：报告的 CPU 段照样逐个打开 sysfs 的 `scaling_cur_freq`（@CherryLemon 的机器上 4.4 秒，设了 `excludeNetwork` 也不变），@colehurwitz 复现的中止发生在同一次 handle 遍历里，`excludeNetwork` 拦不住。构建诊断报告并不是回答「glibc 还是 musl」的低成本办法，所以入口在正常路径上不再构建报告。

**现在的做法。** 入口从 `/proc/self/maps` 读出运行进程中映射的 C 库，并加载为该库构建的 addon。映射是权威信号——它就是 addon 真正会被加载进去的那个库——读取它约 0.1 毫秒；对照之下，安静的 16 核主机上一次报告约 2 毫秒，而在上面报告的机器上是几十秒。只有在完全读不到 `/proc` 时才回退到报告，并在回退期间排除网络段。

**一条规则，三个调用点。** 规则现在住在入口包的一个模块里，flock 入口、原生构建脚本、测试夹具和仓库的本地 bundle registry 都用它。这一点不只是整洁：构建脚本决定编译哪个变体，入口决定加载哪个变体，规则住在两处就可能漂移，留下一个运行时不会加载的宿主 addon。

**一处需要点明的判断。** 当进程同时映射 musl 与 glibc 兼容层的 libc 时，映射里出现的是 musl，于是 musl 优先。它才是进程实际使用的库，也是 addon 必须匹配的那个。这是唯一可能与旧结论不同的情况——旧结论读的是 Node 自身的构建。

分支是 `fix/flock-linux-libc-probe`，依据本帖写成；上游不接受外部 PR，因此该分支暂存在 fork 上：https://github.com/joei4cm/deepseek-harness/tree/fix/flock-linux-libc-probe
