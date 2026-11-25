<!--
状态：草稿，未发布。
用途：Discussion #14318 的回复正文，供作者过目后决定是否发布。
说明：仅源码/机制分析；破坏性命令守卫属产品策略决策，未做代码改动。
-->

# English reply (for posting to Discussion #14318)

I am very sorry this happened to you — losing an entire drive to a command that was never meant to target it is exactly the kind of incident that should never be possible.

On the mechanism, one detail in your report is worth pinning down, because it explains *why* a path could be "truncated" into a drive root rather than merely failing:

- The harness hands the model's command text to PowerShell as a single argument (`pwsh -NoLogo -NoProfile -NonInteractive -Command <string>`), so the quote conversion that corrupted the path happened inside PowerShell's own native-command invocation of `cmd.exe`, not in the harness's argument passing.
- On a GBK-code-page Windows 10, the classic failure is a CJK character whose second byte is `0x5C` (a backslash). When PowerShell re-encodes the `cmd /c "rd /s /q "…字"` line for `cmd.exe`, that trailing-byte backslash escapes the closing quote in cmd's parser, so the argument no longer ends where it should. With one more byte of luck the surviving text parses as `E:\` — and `rd /s /q` does not ask twice.
- This class of bug cannot be fixed by quoting harder in the harness: it lives in the PowerShell-5.1-to-cmd re-encoding layer, and any `cmd /c` invocation with a non-ASCII path near a quote edge can hit it.

Your three expectations map cleanly onto what the harness can and should do, and they are worth stating plainly:

1. **Recursive delete against a filesystem root** (`E:\`, `C:\`, `D:\`, `/`) is a mechanical check on the resolved target, independent of how the text got there. A tool-execution guard that refuses `rd|del|rmdir|rm` recursive forms when the resolved target is a drive root or the workspace root is implementable and would have stopped this incident even though the corruption happened downstream.
2. **Post-assembly validation** is the right instinct, but the assembly happens inside PowerShell, so the hook point has to be the tool layer, not the shell — i.e., a guard sees the *intended* target the model wrote, and can additionally refuse paths that will round-trip through legacy encodings lossily.
3. **Confirmation for recursive/batch deletes** is a policy decision (full-permission mode deliberately removes friction), but "destructive + unrecoverable" is a legitimate carve-out class that deserves design attention.

This is being tracked as a design item; the analysis above documents the code-page trail-byte mechanism so the fix can target the right layer (execution guard + a documented "never recurse a filesystem root" invariant) rather than the quoting layer, which belongs to Windows/PowerShell.

# 中文对照（仅供作者阅读，不发布）

非常抱歉发生这样的事——整条盘被一个本来不该指向它的命令清空，正是绝不该可能发生的那类事故。

机制上，你报告里有一个细节值得钉死，因为它解释了为什么路径会「截断成盘符根目录」而不是单纯报错：

- harness 把模型写的命令文本作为单个参数交给 PowerShell（`pwsh -NoLogo -NoProfile -NonInteractive -Command <string>`），所以损坏路径的引号转换发生在 PowerShell 自己调 `cmd.exe` 的原生命令调用层，不在 harness 的参数传递里。
- 在 GBK 代码页的 Windows 10 上，经典失败是某个中文字符的第二字节是 `0x5C`（反斜杠）。PowerShell 把 `cmd /c "rd /s /q "…字"` 这一行重编码给 `cmd.exe` 时，这个尾字节反斜杠在 cmd 的解析器里转义了收尾引号，参数不再在该结束的地方结束。再差一点运气，幸存文本就解析成 `E:\`——而 `rd /s /q` 不会再问第二遍。
- 这一类 bug 靠 harness 里把引号写得更仔细是修不掉的：它活在 PowerShell 5.1 到 cmd 的重编码层，任何带非 ASCII 路径贴着引号边界的 `cmd /c` 都可能踩中。

你的三条期望恰好对应 harness 能做且应做的事，值得直说：

1. **对文件系统根目录的递归删除**（`E:\`、`C:\`、`D:\`、`/`）是对解析后目标的机械检查，与文本如何到达那里无关。工具执行层守卫在解析目标是盘符根或工作区根时拒绝 `rd|del|rmdir|rm` 递归形式，是可实现的，并且即便损坏发生在下游也能拦住这起事故。
2. **拼装后校验**的直觉是对的，但拼装发生在 PowerShell 内部，所以挂点必须在工具层而不是 shell 层——守卫能看到模型写下的*预期*目标，并且可以额外拒绝会经由旧编码有损往返的路径。
3. **递归/批量删除需确认**是策略取舍（完全权限模式有意去掉摩擦），但「破坏性 + 不可恢复」是一个合理的豁免类别，值得专门的设计讨论。

此项作为设计议题跟进；上面的分析记录代码页尾字节机制，是为了让修复落在正确的层（执行守卫 + 「永不递归文件系统根」的不变量），而不是落在属于 Windows/PowerShell 的引号层。
