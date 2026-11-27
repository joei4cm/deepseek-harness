## Motivation

Windows PowerShell 5.1 上 dsh-doc 的包定位示例会返回退出码 0 却什么都没做：.NET Framework 没有 `ProcessStartInfo.ArgumentList`，失败的 `ArgumentList.Add` 调用不终止脚本，Electron 不带 `-e` 参数启动并直接退出 0，依赖退出码的 agent 会把失败的诊断当成成功。Refs #14403

## Changes

**Interface changes**: None。

**Behavior changes**:

- 更新 `dsh-doc` 技能 `locate-docs` 参考中的 PowerShell 示例：脚本改为通过 stdin 传递（固定 `-` 参数），显式设置 `$ErrorActionPreference = 'Stop'`，启动前校验 `DSH_NODE_EXECUTABLE` 与 `DSH_INSTALL_DIR`，非零 Electron 退出码原样转发，并在 Electron 退出 0 但没有输出时以非零退出。
- 该示例不再依赖 `ArgumentList`（Windows PowerShell 5.1 的 .NET Framework 没有该 API），在 5.1 与 7+ 上都可用；原示例只在 5.1 上静默失败。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**:

文档示例的可执行性检查：从 Markdown 提取实际的 ` ```powershell ` 代码块，在 pwsh 7.4.6 上以 `node` 充当 `DSH_NODE_EXECUTABLE` 执行，覆盖报告者给出的五例验证矩阵。

| 场景 | 期望 | 结果 |
|---|---|---|
| 解析 `@deepseek-ai/dsh-tool-bash` | 退出 0 并打印包目录 | 通过 |
| 解析不存在的包 | 非零退出 + `Cannot find module` | 通过 |
| 可执行文件不存在 | 非零退出 + 进程启动诊断 | 通过 |
| 未设置 `DSH_INSTALL_DIR` | 非零退出 + 变量诊断 | 通过 |
| JS 不输出但退出 0 | 非零退出 + 未报告目录诊断 | 通过 |

负控：旧示例的失败只在 Windows PowerShell 5.1 上出现（.NET Framework 没有 `ArgumentList`，且脚本不中断、退出码转发 0），由报告者在真实 5.1.26100.10068 上复现；本机 pwsh 7.4.6 上 `ArgumentList` 存在，因此无法在此复现原失败，只验证了新示例的行为。

**Test entries**:

- 本机（Linux + pwsh 7.4.6，`node` 充当运行时，`DSH_INSTALL_DIR` 指向源码 `apps/cli`）：五例全部符合预期（成功例退出 0 并打印 `packages/shell/tool-bash`；四个负例退出 1 并给出对应诊断）。
- 本机 `pnpm run test:docs`：通过。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run doc-sync`：41 项通过，`tool catalog` 与 `package paths` 两项失败为上游 master 既有问题，门禁输入与 master 字节一致。
- 未在本机验证：Windows PowerShell 5.1 的真实运行；报告者已在 5.1.26100.10068 上对同一补丁验证五例。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据讨论定位到示例在 5.1 上的假成功路径。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 采用报告者提供的补丁，未做改动。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 在 pwsh 7.4.6 上执行报告者的五例验证矩阵并补充负控说明。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 应用补丁并更新文档。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
