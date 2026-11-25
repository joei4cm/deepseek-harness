<!--
状态：草稿，未发布。
用途：Discussion #14300 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/workspace-navigation-blank-orphans` 分支，未向上游开 PR。
-->

# English reply (for posting to Discussion #14300)

Thank you for the report. I found two paths that can contribute to repeated blank Sessions. Startup restoration retried after every catalog update following a failure. Separately, a successful Session creation could return before the Workspace catalog included the new Session, so a later connection could fail to find that blank and ask the Host to create another.

The proposed branch stops retrying failed startup restoration on catalog updates, preserves an explicit Workspace choice made while the catalogs load, and remembers a recently connected blank during the catalog synchronization gap. A subsequent compatible request names that Session and lets the Host validate reuse. The cache checks the Workspace path, archive status, known blank state and preset, and it does not let an older concurrent request replace the latest candidate.

The focused Workspace service tests cover these cases and pass locally. Explicit Workspace creation failures already use the existing notice; startup restoration failures still go to the console. The Host can still create a new Session if a named blank has started, left the Workspace, or is held by another writer. This branch does not claim to suppress those cases, and a real Desktop reproduction and demonstration remain outstanding.

# 中文对照（仅供作者阅读，不发布）

感谢报告。我确认了两条可能导致空白 Session 重复创建的路径：启动恢复失败后会因每次列表更新重试；此外，Session 创建成功返回时，Workspace 列表可能尚未包含它，后续连接因而找不到这个空白会话并请求 Host 再创建一个。

建议分支停止因列表更新重试失败的启动恢复，保留列表加载期间用户显式选择的工作区，并在列表同步的窗口内记住最近连接的空白会话。兼容的后续请求会指明该 Session，再由 Host 验证能否复用。缓存会检查工作区路径、归档状态、已知的空白状态和 preset，较早并发请求的迟到结果不会覆盖最新候选。

相关工作区服务测试已在本地通过。显式选择工作区时的创建失败已经使用现有提示；启动恢复失败仍只记录到控制台。若指明的空白会话已开始、离开工作区或被其他写者持有，Host 仍可能新建 Session。本分支不宣称阻止这些情况，真实 Desktop 复现和演示仍待完成。
