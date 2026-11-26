## Motivation

宿主以 systemd 用户级 unit 运行时（`dsh web` 常见托管方式），进程环境既无 `DISPLAY` 也无 `WAYLAND_DISPLAY`——但桌面会话活着，且服务继承了 `$XDG_RUNTIME_DIR`，Wayland 合成器 socket 就发布在那里。Linux 桌面判据只读这两个环境变量，于是 `canOpenNativePath()` 回答 false：`/api/present.host` 返回 `available:false`，交付文件卡片隐藏打开按钮并提示「此主机没有可用的桌面」——而 `xdg-open` 本身经同一 socket 就能触达桌面。Refs #14333

## Changes

**Interface changes**: `PathOpenerInternals` 新增可选 `readDir?: (path: string) => readonly string[]` 注入点（socket 探测的确定性测试缝隙；缺省为普通 readdir）。外部调用方不受影响——该类型本就是内部 seam。

**Behavior changes**:
- Linux 桌面判据新增第三条：`$XDG_RUNTIME_DIR` 下存在存活的 `wayland-<n>` socket（正则 `^wayland-\d+$`）即视为有桌面——与 `xdg-open` 在变量缺席时的同一探测依据。`wayland-0.lock` 等伴生文件、无关条目不算数。
- 目录缺失、不可读（EACCES 等）、或无 socket：维持原 false——纯 headless 服务器的答案不变。
- macOS/Windows 与 WSL 分支不变；携带 `DISPLAY`/`WAYLAND_DISPLAY` 的既有场景不变。
- 探测同步执行（`canOpenNativePath` 为同步签名），每次调用实时读目录——`/api/present.host` 无缓存，修复即时生效。

**Module responsibilities and dependencies**: None（改动只在 `dsh-native-command` 的探测函数、其 internals 类型与测试内；无包间依赖变化，消费方 `dsh-session-controller` 的调用方式未动）。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 无显示变量 + runtime dir 有 `wayland-0` | false（报告者场景） | true | 'counts a live Wayland compositor socket in the runtime directory as a desktop' |
| 只有 `wayland-1.lock` / 无关条目 | false | false（不变） | 同用例子断言 |
| runtime dir 缺失或不可读 | false | false（不变） | 同用例 + 'answers no when the runtime directory cannot be listed' |
| `XDG_RUNTIME_DIR` 为空串 | false | false（不变） | 同用例子断言 |
| `DISPLAY`/`WAYLAND_DISPLAY`/WSL 既有判据 | 原行为 | 原行为 | 既有用例（ambient 测试注入空 `readDir` 保持其 parity 语义不变） |

负控：先提交新用例再跑，socket 用例失败（观察 false），其余通过；应用实现后全绿。

**活体验证**（报告者复现步骤在本机重演）：本机 `/run/user/1000` 存在 `wayland-0`；以 `env -u DISPLAY -u WAYLAND_DISPLAY` 模拟 systemd 服务环境调用 `canOpenNativePath()` → true；`env: {}` → false。`GET /api/present.host` 每次请求实时调用该函数，卡片按钮随之恢复。

**Test entries**:
- `pnpm exec vitest run packages/util/native-command/tests --maxWorkers=2` — 90 个用例（89 过、1 平台跳过）通过（本机）。
- `pnpm run build`（build:artifacts + build:check + run-gates）— 通过（本机）。
- `pnpm run typecheck` — 5 个 gate 通过（本机）。
- `pnpm run lint` — 通过（本机；仅存一处与本改动无关的既有 warning）。
- `pnpm run doc-sync` — 43 个 gate 全过（本机）。
- 推送时的 pre-push typecheck — 通过（本机）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据报告核对 `path-opener.ts` 判据与 `/api/present.host` 调用链，确认环境变量缺口。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 在报告四个方案中选定方案 1 的 socket 探测变体（服务端检测、与 `xdg-open` 探测依据一致），否掉反转默认值的 GUI 路线。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计行为矩阵与负控，并在本机清除显示变量活体重演报告者复现步骤。 |
| implementation 技术实现 | auto 模型自主 | 100% | socket 探测、internals 缝隙、JSDoc 与全部测试由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
