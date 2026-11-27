## Motivation

Windows 普通子进程偶发以 `subprocess-local: Windows Job runner exited with exit code 3221226505 before proving its managed range empty` 失败：父进程如实报告 runner 在能证明其受管范围已空之前异常退出（fail-closed 行为正确），但 runner 自身 fd 2 被设为 `'ignore'`，Node 致命错误与模块加载失败的 stderr 文本被丢弃，裸十进制状态也无法与 Windows 状态码对应，「外部终止」「运行时崩溃」「启动失败」对模型和用户不可区分（Discussion #14442）。

## Changes

**Interface changes**: None.

**Behavior changes**:

- Windows Job runner 自身 fd 2 由 `'ignore'` 改为 `'pipe'`：父进程读取该流并保留最后 4 KiB。fd 0/1 仍忽略，fd 3 为 IPC，fd 4–6 承载 target stdio，fd 7 控制管道不变。
- `SUBPROCESS_RUNNER_FAILED` 的两条失败消息（runner 未证明受管范围已空便退出、启动后失败）在有捕获时追加 `; runner stderr: <尾部>`；尾部解码时去掉截断产生的残缺 UTF-8 首字符并 trim，空尾部不改变消息（与旧版逐字节一致）。
- 非零与零退出码均改为同时输出无符号 32 位十进制与十六进制，例如 `exit code 3221226505 (0xC0000409)`；`signal <sig>` 与 `without an exit status` 的文本不变。
- 受管范围的 fail-closed 条件、result 结算语义、清理与终止行为均不变。
- `subprocess-local` README（中英双语）记录 fd 布局变化、消息格式与「stderr 诊断是尽力而为」的限制条目。

**Module responsibilities and dependencies**: None.

**Direction decisions**（对应 Discussion #14442 的四个待决问题）：

1. **范围**：诊断-only——不把「direct result 已交付」与「range 静止」拆分，不放宽 fail-closed。
2. **消息格式**：采用报告建议的 `; runner stderr: <tail>` 内联文本，不做结构化字段，也不做多行合并或行数上限（尾部本身以 4 KiB 字节上界为有界）。
3. **状态码分类**：不做 crash/terminated 分类；本分支只补报告提到的十进制+十六进制输出，分类留作独立小改动。
4. **头部+尾部**：只保留尾部（字节上界内的完整语义是「离退出最近的诊断」）；启动期模块错误位于 stderr 开头的情况，考虑作为后续扩展。

**Message shape**：消息内容变化仅限本报告涉及的 `SUBPROCESS_RUNNER_FAILED` 两条文案与退出码格式；仓库内没有按整段文本匹配的消费方（PTC 按 `SUBPROCESS_RUNNER_FAILED` code 路由，只加前缀），`snapshots/` 与 `tests/expected/` 不产生该消息。外部若硬编码旧文本需要适配——模型可见文本本身由包内单测逐字固定。

## Testing

**Test design**（行为矩阵）：

| 场景 | 变更前 | 变更后 | 覆盖用例 |
|---|---|---|---|
| runner 异常退出且写过 stderr | `exit code 1` + 无尾部 | `exit code 1 (0x00000001)` + `; runner stderr: …` | 新增用例（异常退出） |
| runner 启动后 `error` 事件 | 消息只含错误 | 消息追加 stderr 尾部 | 新增用例（post-start error） |
| stderr 超过 4 KiB 且截断切在多字节字符中间 | 无此路径 | 只保留尾部、残缺首字符被去掉 | 新增用例（截断边界） |
| stderr 为空白 / fd 2 未管道化 | 消息为原始文案 | 消息逐字节不变 | 新增用例 |
| runner stdio 布局 | fd 0–2 全 `'ignore'` | fd 2 为 `'pipe'` | 更新的布局断言（windows-job、spawn-runner） |
| 正常退出、target-exit、IPC 失败、cancel | 不变 | 不变 | 既有用例 |

**Test entries**：

- 本地 `env -u NoDefaultCurrentDirectoryInExePath NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run packages/subprocess/subprocess-local/tests --maxWorkers=2`：15 个文件、393 个测试通过、13 个跳过（跳过项为平台相关用例）。
- 覆盖率（`--coverage --coverage.include='packages/subprocess/subprocess-local/src/windows-job.ts' --coverage.include='packages/subprocess/subprocess-local/src/runner-launch.ts'`）：两个改动文件语句 253/253、分支 202/202、函数 46/46、行 228/228，均为 100%。
- 反向对照：把 `packages/subprocess/subprocess-local/src/windows-job.ts` 与 `src/runner-launch.ts` 还原为 `origin/master` 后，5 个用例失败（4 个 stdio 布局断言 + 新增的 stderr 尾部用例）；恢复修复后全部通过。
- 本地 `NODE_OPTIONS="--max-old-space-size=8192" pnpm run typecheck`：5 个门禁全部通过。
- 本地 `pnpm run lint`：通过。
- 本地 `pnpm run test:docs`：21 通过、0 失败。
- 本地 `pnpm run doc-sync`：41 通过、2 失败。2 个失败均为本仓库既有问题，与本次改动无关：工具目录缺少 `tool-working-directory`，以及 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/guide.md` 仍引用上游已删除的 `packages/experimental/ptc-runtime-python`。
- 推送钩子 typecheck 门禁：5 通过、0 失败。
- 真实 Windows 崩溃路径（注入 `0xC0000409` 等）无法在 Linux 本地复现：本环境用假子进程单测覆盖消息拼接与 fd 布局，真实 crash 的端到端证据依赖报告方的账本事后对照或 CI。
- 没有 CI 结果：上游不接受外部 PR，因此分支暂存在 fork。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复核上游 Discussion #14442 的机制分析，确认 runner fd 2 被忽略、stderr 文本被丢弃是诊断缺口所在。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「fd 2 管道 + 4 KiB 尾部 + 十进制/十六进制退出码」的诊断-only 形状，并逐条回答报告提出的四个待决问题。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计异常退出、post-start error、4 KiB 截断边界与空白/无管道四类用例，跑包内覆盖率与反向对照。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 实现 stdio 布局、尾部捕获与消息格式化，更新两处用例断言与中英双语 README。 |
| review 评审处理 | n/a 暂不适用 | — | No review comments have been handled. |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
