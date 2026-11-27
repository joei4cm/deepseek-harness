<!--
状态：草稿，未发布。
用途：Discussion #14403 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/dsh-doc-powershell-example` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）。
-->

# English reply

Thanks for the precise reproduction and the patch — it is correct, and we landed it unchanged on the referenced file (`packages/preset/agent-preset/skills/dsh-doc/references/locate-docs.md`) on a fork branch, `fix/dsh-doc-powershell-example`.

We verified the patched example by extracting the actual PowerShell block from the Markdown and running it under PowerShell 7.4.6 on Linux, with `node` standing in for the Electron executable and the source `apps/cli` as the install directory. All five cases from your matrix behaved as expected: the lookup prints the package directory and exits 0; a nonexistent package, a nonexistent executable, an unset `DSH_INSTALL_DIR`, and a silent-success script each exit 1 with the corresponding diagnostic.

One boundary to note: the original failure only exists on Windows PowerShell 5.1, because .NET Framework lacks `ProcessStartInfo.ArgumentList` and the failing `Add` calls do not stop the script. PowerShell 7 has `ArgumentList`, so the old block cannot reproduce the bug here; your own 5.1 run remains the evidence for that half. The new block avoids `ArgumentList` entirely and uses `Arguments` plus stdin, which both runtimes support.

# 中文对照

感谢精确的复现与补丁——补丁是对的，我们已在 fork 分支 `fix/dsh-doc-powershell-example` 上原样落到所指文件（`packages/preset/agent-preset/skills/dsh-doc/references/locate-docs.md`）。

我们从 Markdown 中提取实际的 PowerShell 代码块，在 Linux 上的 PowerShell 7.4.6 中运行，以 `node` 代替 Electron 可执行文件、以源码 `apps/cli` 作为安装目录。你给出的五例全部符合预期：查找打印包目录并以 0 退出；不存在的包、不存在的可执行文件、未设置 `DSH_INSTALL_DIR`、以及静默成功的脚本，各自以 1 退出并给出对应诊断。

需要说明的边界：原失败只在 Windows PowerShell 5.1 上存在，因为 .NET Framework 没有 `ProcessStartInfo.ArgumentList`，且失败的 `Add` 调用不中断脚本。PowerShell 7 有 `ArgumentList`，因此旧代码块在这里无法复现该 bug；你自己的 5.1 运行仍是那一半的证据。新代码块完全避开 `ArgumentList`，改用 `Arguments` 与 stdin，两个运行时都支持。
