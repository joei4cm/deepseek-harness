## Motivation

#14258 的姊妹缺陷。PR 08（`fix/native-command-systemroot-explorer`）已让 path opener 从 `%SystemRoot%` 解析 Explorer；但同一 Discussion 暴露的缺陷类在包内还有一处：Windows 文件关联适配器（`windowsFileApplications`）以裸名 `powershell.exe` 传给 `execFile`，经 `PATH` 解析。Windows PowerShell 是系统组件，实际位于 `%SystemRoot%\System32\WindowsPowerShell\v1.0\`；一台 `PATH` 缺少系统目录的 Windows Host 上，关联应用查询与显式启动会以 `ENOENT` 失败。

两处缺陷同型、修复机制相同（`%SystemRoot%` 锚定 + `win32.join`），且本 PR 把 path opener 的局部助手提取为共享解析器，因此**基于 PR 08 的分支续作**（栈式分支）；合入顺序在 PR 08 之后。

范围说明：WSL 保持裸名——interop 对 Windows 可执行文件的解析走 interop 路径而非 Windows 路径（Linux 侧无法执行 Windows 路径的 PowerShell），裸名才能被解析。

Refs #14258

## Changes

**Interface changes**

- `host-environment`（`dsh-native-command` 内部模块）新增共享导出 `windowsSystemCommand(env, name, ...path)`：`SystemRoot` 有定义且非空时返回 `win32.join(SystemRoot, ...path, name)`，否则回退裸名。
- `windowsFileApplications` 新增第五参数 `command`（要 spawn 的 PowerShell 可执行文件），由调用方解析后传入——与 path opener 的 `openWindowsPath(path, signal, run, command)` 同一架构。

**Behavior changes**

- Windows 关联查询（`nativeFileApplications`）与显式启动（`openNativeFileApplication`）的 PowerShell 从 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` 启动（该布局是系统组件的固定位置）；`SystemRoot` 未定义或为空时回退裸名。
- WSL 两条链路保持裸名：`desktopTarget` 现在报告 `wsl`（是否经 WSL 到达 Windows 桌面），分发层据此选择裸名或绝对路径。
- path opener 的 Explorer 解析改用共享助手（删除 PR 08 引入的局部 `windowsExplorer`），行为不变。
- `win32.join` 使产出的命令与运行测试的平台无关；`SystemRoot` 解析的全部理由（Windows 上始终有定义、`PATH` 可被裁剪、`ENOENT` 机理）集中在共享助手的 JSDoc，不再两处重复。
- README（EN/ZH）同步：文件应用段落补充 PowerShell 的 `%SystemRoot%` 启动；Known Limitations 条目改写——powershell 半边已修，剩余限制只有 WSL interop 对两个裸名的解析。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-native-command` | 无 shell 的宿主命令执行与桌面路径打开 | 变更：`host-environment` 新增共享 Windows 系统可执行文件解析；path opener 改用；Windows 文件关联适配器接收已解析命令 |
| `dsh-open-in-app` | 文件关联路由的消费方 | 不变：经 `nativeFileApplications` / `openNativeFileApplication` 自动受益 |

依赖边：无新增或删除。

调用流程：

```text
文件关联查询 / 显式启动（win32 或 WSL 翻译后）
  → nativeFileApplications / openNativeFileApplication
  → desktopTarget: 平台判定与 WSL 翻译，返回 { platform, path, wsl }
  → windowsPowershell(env, wsl)
      WSL    → 'powershell.exe'（interop PATH 解析）
      win32  → windowsSystemCommand(env, 'powershell.exe', 'System32', 'WindowsPowerShell', 'v1.0')
  → windowsFileApplications(path, application, signal, run, command)
  → run(command, ['-NoProfile', '-NonInteractive', '-STA', …, '-File', scriptPath])
      绝对路径使 execFile 不再经 PATH 解析 PowerShell
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| `SystemRoot` 有值的 win32 查询与启动 | 两个入口都以 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` spawn | `starts PowerShell from %SystemRoot% so a PATH without the system directories still queries and launches` |
| `SystemRoot` 未定义 / 空字符串 | 回退裸名（经 PATH 解析） | `resolves the bare PowerShell name through PATH when %SystemRoot% is unset/blank`（it.each 两例） |
| 不注入 `env`（默认采样当前环境） | 命令来自 `process.env`，断言在 Linux 与 Windows CI 上都成立 | `resolves the adapter command from the current environment when no override is supplied` |
| WSL（即使 `SystemRoot` 有值） | 裸名，interop 负责解析 | `uses the Windows desktop for WSL paths and rejects an empty translation`（env 补 `SystemRoot`，断言两次 spawn 都是裸名） |
| 既有 win32 用例的确定性 | 注入 `env: {}` 固定，Windows CI 的环境 `SystemRoot` 不得影响断言 | 既有两处 win32 用例补钉 `env: {}`（编码隔离、CreateProcess 上限） |
| Explorer 解析行为不回归 | path opener 全套用例原样通过（命令断言不变） | 既有 path-opener 套件 |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `starts PowerShell from %SystemRoot% so a PATH without the system directories still queries and launches` | 查询与启动都以绝对路径 spawn |
| `resolves the bare PowerShell name through PATH when %SystemRoot% is unset/blank` | 未定义与空两种 env 都回退裸名 |
| `resolves the adapter command from the current environment when no override is supplied` | 不注入 env 时经 `process.env` 解析（回退路径的覆盖；期望值按环境计算，跨平台确定） |
| `uses the Windows desktop for WSL paths and rejects an empty translation` | WSL 下查询与启动保持裸名，即使 `SystemRoot` 有值 |
| 既有两处 win32 用例的 `env: {}` 钉住 | Windows CI 上测试不读环境 `SystemRoot`，断言确定 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/util/native-command
  Test Files  6 passed | 1 skipped (7)
  Tests  102 passed | 1 skipped (103)

pnpm exec vitest run packages/host/open-in-app packages/api/session-controller packages/api/settings-controller
  Test Files  58 passed (58)
  Tests  1242 passed (1242)

pnpm exec vitest run --coverage \
  --coverage.include='packages/util/native-command/src/**/*.ts' \
  packages/util/native-command packages/host/open-in-app
  Statements   : 100% ( 285/285 )
  Branches     : 100% ( 257/257 )
  Functions    : 100% ( 41/41 )
  Lines        : 100% ( 240/240 )
  ※ desktop-entry.ts 的覆盖用例在 open-in-app 的 icons / host-routes 套件里，
    与本 PR 无关；带上消费方后逐文件 100%。

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent identified the sibling defect while recording PR 08's Known Limitations entry (the Windows file-association adapter spawning `powershell.exe` by bare name), located it in the repository, and chose to fix it as a stacked change so the shared resolver replaces PR 08's local helper; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent designed the shared `windowsSystemCommand` helper in `host-environment`, passed the resolved command into the Windows adapter (mirroring the path opener's `openWindowsPath` architecture), had `desktopTarget` report WSL so the interop keeps the bare name, and anchored PowerShell at its fixed OS layout `System32\WindowsPowerShell\v1.0`; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent added the absolute-path, fallback, ambient-environment, and WSL tests, pinned `env: {}` in the existing win32 tests so Windows CI stays deterministic, and confirmed 100% per-file coverage; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the helper, the dispatcher threading, the adapter signature, the English and Chinese README revisions, and re-recorded the translation pairs. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
