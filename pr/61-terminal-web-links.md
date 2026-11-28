## Motivation

内置侧边栏终端里 `vite`、`next dev` 等命令输出的本地服务地址只是普通文本，点击无反应，必须手动选中复制再粘贴到浏览器（Discussion #14456）。报告方定位了根因：`ui-sidebar-terminal` 的 xterm 初始化只加载了 `FitAddon`，没有加载 xterm 官方的 `WebLinksAddon`；社区已有两个第三方插件在补这个能力，说明需求真实存在。

Refs #14456

## Changes

**Interface changes**: None（新增的 `@xterm/addon-web-links` 是 devDependency，不改变任何公开接口、配置项或注册槽位）。

**Behavior changes**:

- 终端输出中打印的 http/https 地址变为可点击：悬停显示链接态，点击后在浏览器中打开（Web 为新标签页；Desktop 经既有 `setWindowOpenHandler` 路由到系统浏览器）。
- 打开动作与聊天区外链使用同一个调用形态（`window.open(uri, '_blank', 'noopener,noreferrer')`，见 `ui-chat/src/client/apply.ts` 的 `openExternalLink`）：Desktop 的窗口 handler 拒绝所有弹窗并把 http/https 转交 `shell.openExternal`，因此必须把最终 URL 放进一次 `window.open` 请求，addon 默认的「先开 about:blank 再导航」在 Desktop 上会被拒绝。
- 协议白名单在 handler 内本地判定（仅 `http://` / `https://`）：终端输出是不可信文本，白名单不单独依赖 addon 的默认正则；其他协议保持纯文本。
- 与聊天区不同：聊天区外链有「在侧栏浏览器打开」的用户偏好，本包不引入该偏好——终端 URL（本地服务地址）的常规去向是系统浏览器，报告方的建议也是默认直接打开。无新增配置项。
- 无新增文案：链接无标题、无 tooltip 文本；README 中英双语的 Summary 与实现折叠段补了一句行为事实，配对记录已重新记录。

**Module responsibilities and dependencies**: None.（`@xterm/addon-web-links` 是第三方浏览器库，按依赖规则进 `devDependencies`，随 `client.terminal.js` 私有打包，与 `@xterm/xterm`、`@xterm/addon-fit` 同一懒加载 chunk。）

## Testing

**Test design**（行为矩阵）：

| 场景 | 变更前 | 变更后 | 覆盖用例 |
|---|---|---|---|
| 点击输出中的 http/https 地址 | 无反应 | 浏览器打开该地址 | 新增组件用例 + 新增 e2e 用例 |
| 点击 file: 等其他协议文本 | 无反应 | 仍无反应（保持纯文本） | 新增组件用例 + 新增 e2e 用例 |
| `window.open` 调用形态 | — | `(uri, '_blank', 'noopener,noreferrer')` | 新增组件用例 |
| 终端输入、补全、主题、配色、恢复 | 不变 | 不变 | 既有组件与 e2e 用例 |

**Test entries**:

- 本地 `pnpm exec vitest run packages/client/ui-sidebar-terminal/tests`：8 个文件、72 个测试（71 通过 + 1 平台跳过）。
- 组件覆盖率（`--coverage.include='packages/client/ui-sidebar-terminal/src/**'`）：语句 440/440、分支 264/264、函数 140/140、行 335/335，均为 100%。
- 反向对照：把 `src/client/terminal.tsx` 还原为 `origin/master` 后，新增组件用例失败（link addon 未注册），其余用例通过；恢复修复后全部通过。
- 真实应用验证：`DSH_SNAPSHOT=replay` 下运行 `apps/web/tests/sidebar-terminal.e2e.ts`（真实 Loader + Remote mux + Chromium + 本地 PTY）：新增用例把真实 shell 打印的 `http://127.0.0.1:<port>/terminal-link-open-probe` 悬停（`.xterm-screen` 出现 `xterm-cursor-pointer` 链接态）后点击，断言打开的浏览器上下文 URL 精确匹配；`file:///etc/hosts` 点击后 1.5 秒内无任何新页面；悬停截图经人工目检——URL 带下划线链接态，`file:` 行保持纯文本。同文件其余 11 个用例（配色、主题保持、目录、补全、持久化、配额、双窗口、断线重连等）全部通过，既有 golden 快照回放未变。
- `pnpm run test:gui`：834 个文件、14766 个测试全部通过（多次运行均无失败；其中一次运行记录了 1 个来自 `ui-renderer/inline-slots` 边界的 unhandled error——jsdom `standardFontDataUrl` 崩溃路径，单文件隔离复跑通过、同改动复跑不出现、master 源码对照运行也不复现，属全车道负载下的偶发顺序问题，与本次改动无关）。
- `pnpm run lint`：通过。`pnpm run typecheck`：5 门禁全部通过。`pnpm run build`：10 门禁全部通过。`pnpm run test:docs`：21 通过、0 失败。`pnpm run doc-sync`：43 通过、0 失败。
- `pnpm run hygiene`：除 `vendor rescope` 外全部通过（含 `client packages`、`publint`、`package dependencies`）。`vendor rescope` 失败为本 checkout 既有状态：它报告的 2 个文件与 `origin/master` 字节一致（`git diff origin/master --stat` 为空），而该检查是对全部 tracked 文件的纯内容判定，与本分支改动无关。
- 没有 CI 结果：上游不接受外部 PR，因此分支暂存在 fork。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复核上游 Discussion #14456 的根因定位（只加载 FitAddon），确认缺失 `WebLinksAddon` 是全部症状的原因。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 决定加载官方 addon 并自带协议白名单的一次性 `window.open` handler，不引入修饰键配置，也不把聊天区的侧栏浏览器偏好带进终端。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计组件用例（协议矩阵 + 调用形态）与真实应用 e2e（点击打开、其他协议惰性、悬停目检），并做反向对照。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 加装依赖、注册 addon、同步 README 双语事实并重新记录配对。 |
| review 评审处理 | n/a 暂不适用 | — | No review comments have been handled. |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
