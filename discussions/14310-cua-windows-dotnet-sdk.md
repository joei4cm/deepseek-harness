<!--
状态：草稿，未发布。
用途：Discussion #14310 的回复正文，供作者过目后决定是否发布。
说明：仅源码分析，无代码改动；错误分类方案属设计决策。
-->

# English reply (for posting to Discussion #14310)

Your two asks map onto one design point: the preparation error is intentionally raw. `prepareNativeExecutable` in `dsh-cua/native-build` spawns the compiler, collects bounded stdout/stderr, and on non-zero exit throws `Computer Use native preparation failed (<exitCode>, <signal>): <diagnostics>` verbatim. The settings page then displays that text. Nothing in the path classifies *why* dotnet failed, which is why "no SDK installed" and "helper missing" surface identically.

Two ways to improve it, with different fragility profiles:

1. **Classify the dotnet output** (string-match `No .NET SDKs were found` / `does not exist`): the smallest change — wrap `buildNativeExecutable` (or the throw site in `dsh-cua/native-build`) and append a "building the Windows Computer Use helper requires the .NET 10 SDK; a runtime alone is not sufficient" hint when the pattern matches. The fragility is that dotnet's messages are localized — a French or Japanese Windows emits the same failure with different text, so a localized-machine no-SDK case would still read as generic. Tolerable if the hint is *additive* (raw output kept, as you suggested), but a false negative means the improvement silently doesn't apply.
2. **Probe before compiling**: run `dotnet --list-sdks` once before `dotnet publish` and report "dotnet present but no SDK installed" from the probe's own empty output instead of parsing the compile failure. This distinguishes SDK-absent from SDK-present-but-failed-to-publish regardless of localization, and also gives the "helper not present in this package" vs "build needed but SDK missing" split you ask for: `prepareNativeExecutable` already knows which branch it took (`sourceNativePackage` → compile, else resolve the bundled executable), so each branch can own its own failure message.

The second is the more durable fix; the first is a cheap improvement on top of the same branch split. Related: #14226's `ENOENT` is the sibling signature — same "which preparation path and why" ambiguity, from the bundled-helper branch rather than the compile branch — so a fix for this should probably give both branches their own failure text rather than patch only the compile path.

One caveat on scope: the report is from a third-party repackage (`Arcuchi Harness 0.2.2-alpha.3`), and the bundled-helper path is precisely where repackaging can change which branch runs. Worth confirming on an official installer whether `helperPath` resolution or the compile path was what actually failed before shipping classification text aimed at the wrong branch.

# 中文对照（仅供作者阅读，不发布）

你的两条诉求映射到同一个设计点：准备阶段的报错是有意的原文透传。`dsh-cua/native-build` 的 `prepareNativeExecutable` spawn 编译器、收集有界的 stdout/stderr，非零退出时原样抛出 `Computer Use native preparation failed (<exitCode>, <signal>): <diagnostics>`。设置页直接展示这段文本。整条链路不分类 dotnet *为什么*失败，所以「没装 SDK」和「helper 不存在」长一个样。

两种改进方向，脆性不同：

1. **对 dotnet 输出做分类**（字符串匹配 `No .NET SDKs were found` / `does not exist`）：最小改动——包一层 `buildNativeExecutable`（或 `dsh-cua/native-build` 的抛错点），命中模式时附加「构建 Windows Computer Use helper 需要 .NET 10 SDK，仅装 Runtime 不够」的提示。脆性在于 dotnet 的消息是本地化的——法文/日文 Windows 的同一种失败文本不同，本地化机器上没装 SDK 仍会落到通用提示。如果提示是*附加式*的（原文保留，如你所建议）尚可容忍，但假阴性意味着改进静默不生效。
2. **编译前探测**：在 `dotnet publish` 前先跑一次 `dotnet --list-sdks`，用探测本身的空输出判定「装了 dotnet 但没有 SDK」，而不是解析编译失败文本。这能在任何语言环境下区分「缺 SDK」与「有 SDK 但 publish 失败」，也顺带解决你要的「包内没 helper」与「需要编译但缺 SDK」的区分：`prepareNativeExecutable` 本来就知道自己走了哪个分支（`sourceNativePackage` → 编译，否则解析打包的 executable），每个分支可以拥有自己的失败文案。

第二种是更耐用的修法；第一种在同一分支划分上是廉价补充。相关：#14226 的 `ENOENT` 是姊妹签名——同一个「走了哪条准备路径、为什么」的歧义，但来自打包 helper 分支而非编译分支——所以修法更该给两个分支各自的失败文案，而不是只打编译路径的补丁。

范围上有一点保留：报告来自第三方重打包（`Arcuchi Harness 0.2.2-alpha.3`），而打包 helper 路径正是重打包可能改变走哪个分支的地方。建议在官方安装器上先确认实际失败的是 `helperPath` 解析还是编译路径，再为正确分支发分类文案。
