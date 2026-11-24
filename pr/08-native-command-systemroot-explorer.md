## Motivation

#14258 报告：在一台 `PATH` 缺少 `C:\Windows` 的 Windows Host 上，工作区菜单的「在文件夹显示」与文件定位都失败，客户端弹出 `path.revealError`。

根因在 `dsh-native-command` 的 path opener：`explorer.exe` 以裸名传给 `execFile`，Node 经 `PATH` 解析可执行文件；Explorer 实际位于 `%SystemRoot%`（通常 `C:\Windows`），不在 `PATH` 里时 spawn 以 `ENOENT` 失败。两条上报链路都经过这里：

- 打开（工作区「在文件夹显示」）：`dsh-open-in-app` 的 shell-open 路由 → `runShellOpen` → `openNativePath`（`env: internals.env`，即 `process.env`）；
- 定位（文件 reveal）：`dsh-session-controller` → `revealNativePath`（默认 internals → `process.env`）。

`%SystemRoot%` 在 Windows 上始终有定义（先于任何 PATH 处理由系统注入），所以它是可靠的解析锚点。仓内已有同型先例：`dsh-pwsh-local` 以 `env.SystemRoot ?? 'C:\\Windows'` 定位 PowerShell。

范围说明：WSL 保持裸名——interop 对 Windows 可执行文件的解析走 interop 路径而非 Windows 路径（Linux 侧无法执行 `C:\Windows\explorer.exe`），裸名 `explorer.exe` 才能被解析。同类的 `file-applications-windows.ts` 裸名 `powershell.exe` 是独立缺陷，按「拆分独立变更」记入 Known Limitations，不在本 PR 内修。

Refs #14258

## Changes

**Interface changes**

- 无公开 API 变化。`PathOpenerInternals.env` 的 JSDoc 扩展：env 除 WSL 标记与桌面 Linux 浏览器约定外，还参与 Windows Explorer 位置（`SystemRoot`）的解析。

**Behavior changes**

- 新增内部助手 `windowsExplorer(env)`：`SystemRoot` 有定义且非空时返回 `win32.join(SystemRoot, 'explorer.exe')`，否则回退裸名 `explorer.exe`。显式用 `win32.join`，使产出的命令与运行测试的平台无关（同一断言在 Linux 与 Windows CI 上都成立）。
- Windows 打开意图（`openNativePathWithIntent` 的 win32 分支，覆盖 default / association / text-editor 三种 intent）与 `revealNativePath` 的 explorer 分支都改为 spawn 该解析结果——绝对路径使 `execFile` 不再经 `PATH` 解析 Explorer。
- WSL 两条链路（`openWslPath` 与 reveal 的 linux 分支）保持裸名，行为不变。
- 回退语义：`SystemRoot` 未定义或为空字符串时用裸名（Windows 实机始终有定义；该分支服务于异常环境与测试）。
- Explorer 的既有语义不变：编码 file URI 目标、exit 1 视为委托交接、取消优先于委托 exit 1。
- README（EN/ZH）同步：`SystemRoot` 解析进入「Opening a Host path」段落；Known Limitations 新增一条，记录 `powershell.exe` 裸名与 WSL interop 裸名 `explorer.exe` 在缺系统目录的 `PATH` 下同样 `ENOENT`。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-native-command` | 无 shell 的宿主命令执行与桌面路径打开 | 变更：path opener 的 win32 分支从 `%SystemRoot%` 解析 Explorer，`revealNativePath` 同步 |
| `dsh-open-in-app` | 工作区/文件「在应用中打开」的宿主路由 | 不变：本就透传 `env: internals.env`，自动受益 |
| `dsh-session-controller` | 会话面 reveal 的消费方 | 不变：走默认 internals（`process.env`），自动受益 |

依赖边：无新增或删除。

调用流程（打开）：

```text
工作区菜单「在文件夹显示」
  → open-in-app launchResolved → runShellOpen
  → openNativePath(path, signal, { env: internals.env })      // process.env
  → openNativePathWithIntent: platform win32
  → openWindowsPath(path, signal, run, windowsExplorer(env))
  → windowsExplorer: SystemRoot 有值 → 'C:\Windows\explorer.exe'；否则裸名
  → runExplorer → execFile 绝对路径，不再经 PATH 解析
```

调用流程（定位）：

```text
session-controller revealPath
  → revealNativePath(path, signal)                             // 默认 internals → process.env
  → manager explorer: platform win32 → command = windowsExplorer(env)
    （platform linux/WSL 先 wslpath -w 翻译，command 保持裸名）
  → runExplorer('/select,', explorerTarget(windowsPath))
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| `SystemRoot` 有值的 win32 打开与定位 | 两个入口都以 `C:\Windows\explorer.exe` spawn | `starts Explorer from %SystemRoot% so a PATH without C:\Windows still opens and reveals` |
| `SystemRoot` 未定义 / 空字符串 | 回退裸名（经 PATH 解析） | `resolves the bare Explorer name through PATH when %SystemRoot% is unset/blank`（it.each 两例） |
| WSL（linux + `WSL_DISTRO_NAME`，即使 `SystemRoot` 有值） | 保持裸名，interop 负责解析 | `keeps the bare Explorer name under WSL, where the interop resolves it` |
| 既有 win32 用例的确定性 | 注入 `env: {}` 固定，Windows CI 的环境 `SystemRoot` 不得影响断言 | 既有 7 处 win32 用例补钉 `env: {}`（编码目标、盘根、目录、文本文档、可见性、浏览器文档、特殊字符） |
| 消费方链路不回归 | open-in-app / session-controller / settings-controller 全绿 | 既有套件（其 shell-open 用例以 `env: {}` 断言裸名，与回退语义一致） |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `starts Explorer from %SystemRoot% so a PATH without C:\Windows still opens and reveals` | `openNativePath` 与 `revealNativePath` 在 `env: { SystemRoot: 'C:\\Windows' }` 下都以绝对路径 spawn |
| `resolves the bare Explorer name through PATH when %SystemRoot% is unset/blank` | 未定义与空两种 env 都回退裸名 |
| `keeps the bare Explorer name under WSL, where the interop resolves it` | WSL 下打开与定位均保持 `explorer.exe`，即使 `SystemRoot` 有值 |
| 既有 7 处 win32 用例的 `env: {}` 钉住 | Windows CI 上测试不读环境 `SystemRoot`，断言确定 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/util/native-command
  Test Files  6 passed | 1 skipped (7)
  Tests  99 passed | 1 skipped (100)

pnpm exec vitest run packages/host/open-in-app packages/api/session-controller packages/api/settings-controller
  Test Files  58 passed (58)
  Tests  1242 passed (1242)

pnpm exec vitest run --coverage \
  --coverage.include='packages/util/native-command/src/**/*.ts' \
  packages/util/native-command packages/host/open-in-app
  Statements   : 100% ( 283/283 )
  Branches     : 100% ( 251/251 )
  Functions    : 100% ( 40/40 )
  Lines        : 100% ( 238/238 )
  ※ 只跑本包测试时 desktop-entry.ts 有缺口：其覆盖用例在 open-in-app 的
    icons / host-routes 套件里，与本 PR 无关；带上消费方后逐文件 100%。

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
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent triaged the Discussion queue, reproduced the reported mechanism in the repository (bare `explorer.exe` resolved through `PATH` by `execFile`, and both reported call chains through `openNativePath` and `revealNativePath`), and selected the Discussion from its own candidate list; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent designed the `%SystemRoot%`-anchored resolution with `win32.join`, kept WSL on the bare name because interop resolves Windows executables itself, and shaped the helper around the per-file coverage gate (an `env`-only helper so no unreachable platform branch exists); prior art is `dsh-pwsh-local`'s `env.SystemRoot` handling. The author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent added the absolute-path, fallback, and WSL tests, pinned `env: {}` in seven existing win32 tests so Windows CI stays deterministic, verified the consumer suites, and confirmed 100% per-file coverage; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the helper and call-threading, the English and Chinese README revisions, and re-recorded the translation pairs. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
