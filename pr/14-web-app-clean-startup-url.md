## Motivation

Discussion #14253 报告的攻击链成立：`dsh web` 启动时打印的 `dsh web: http://127.0.0.1:<port>/?token=…` 把启动令牌放进了进程输出。任何能读到该输出的进程——服务日志、重定向到文件的 stdout、被捕获的终端面板，以及 agent 自己可读的命令输出——都能用这个令牌换一个 owner 浏览器会话（`authorizeIndex` 兑换 owner Cookie），从而在 agent 控制的页面里回答 harness 自己的审批请求。这直接破坏了「审批必须由人来回答」这条人类授权边界。

在 master 上的核对结论：

1. **唯一的暴露点是那一行打印**。令牌插件此前把带令牌的地址放进 `webserver/entry-url` 条目的 `url` 字段，而 WebApp 直接 `console.log(`${entry.label}: ${entry.url}`)`。`DSH_WEB_URL` 与 agent 运行时上下文里给的是干净根地址，所以暴露面仅限启动输出。
2. **默认浏览器交接本来就不经过输出**。WebApp 把 `entry.url` 交给操作系统的默认浏览器，令牌只落在浏览器的地址栏与历史里，从不进入进程输出。带令牌的地址因此可以只作为「交接地址」存在。
3. **人类自己的登录路径不能因此断掉**。地址行必须无凭据地可读；一次性登录链接需要另有一条出口，且在输出被重定向到文件/服务日志时不应默认出现——那种输出是宿主机上任意进程都能读的。

修复方向（与作者一致）：**只打印干净 URL**。条目新增「发布地址」与「交接地址」两个字段，令牌只挂在交接地址上；默认浏览器交接照旧走带令牌的地址（out-of-band，不落日志），人类的一次性登录链接在交互终端下打印，或由部署用 `--print-login-url` 显式要求。

Refs #14253

## Changes

**Interface changes**

- `WebEntryUrl`（`@deepseek-ai/dsh-host-webserver`）新增可选字段 `openUrl`：交接地址，与发布地址不同时才出现。`WebEntryUrl.url` 的语义收紧为「不含凭据的完整入口地址」。
- `Config.printLoginUrl`（`@deepseek-ai/dsh-web-app`）新增布尔字段，默认 `false`。
- CLI 新增 `--print-login-url`（`dsh --profile web --print-login-url`），映射到 `webStartup.printLoginUrl`。
- `webserver/entry-url` 事件负载的类型未变（`WebEntryUrl[]`），只是条目多了一个字段；事件 JSDoc 与 `docs/event-producer-consumer.md` 同步。

**Behavior changes**

- 启动输出的地址行永远是干净的根地址（`dsh web: http://127.0.0.1:<port>/`），不再含 `?token=`。
- 一次性登录链接单独成行（`dsh web login link: <url>`），且只在两种情况出现：部署显式设置 `printLoginUrl`，或进程输出是交互式终端（`process.stdout instanceof WriteStream`）。输出被重定向时打印 `dsh web: redirected output carries no one-time login link`，避免把凭据写进日志。显式要求打印时，额外打印一行说明「读到这段输出的人都能打开 owner 会话」。
- 默认浏览器交接改为打开 `openUrl ?? url`，行为与地址一致：交接地址携带凭据，但不经过进程输出。浏览器打开失败时的提示改为指向「启动输出中的一次性登录链接」，并继续把地址替换为 `[login URL]`。
- `dsh-client-remote-connection` 的 owner-only `loginUrl()`（GUI 的「复制一次性链接」入口）从 `openUrl` 读取带令牌的地址，因此 GUI 主路径不受影响；它按「同源同路径且恰有一个 token 参数」筛选条目，多贡献者时也不会取错。
- `authentication-token` 的 401 响应文案改为指向启动输出中的一次性登录链接。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-host-webserver` | Web 服务器：HTTP/WS 路由与入口地址事件 | 变更：`WebEntryUrl` 增加 `openUrl`，`url` 收紧为不含凭据 |
| `dsh-host-authentication-token` | 启动令牌与浏览器会话 Cookie | 变更：贡献的条目以 `url` 发布无凭据地址，带令牌的地址放进 `openUrl` |
| `dsh-web-app`（bundle） | Web 运行时组合：打印入口地址、交接浏览器 | 变更：打印无凭据地址 + 条件打印登录链接；交接使用 `openUrl`；新增 `printLoginUrl` 与 `--print-login-url` |
| `dsh-client-remote-connection` | Remote 连接的匿名登录页与 owner 复制链接入口 | 变更：从 `openUrl` 读取带令牌的地址 |

依赖边：无新增或删除。

调用流程：

```text
启动就绪
  webserver/entry-url(baseUrl, entries)
    authentication-token → { label: 'dsh web', url: baseUrl（无凭据）, open: true, openUrl: baseUrl?token=… }
  WebApp 打印
    地址行   dsh web: <url>                     （任何情况下都不含 token）
    登录行   dsh web login link: <url>          （仅 printLoginUrl 或交互终端）
             dsh web: redirected output carries no one-time login link   （其余情况）
  默认浏览器交接
    打开 openUrl ?? url                          （凭据不经过进程输出）
  GUI 复制链接（Remote 连接）
    loginUrl() → 条目的 openUrl                 （owner 独占入口）
```

**Docs**

- `packages/bundle/web-app/README.md`(+`.zh`)：新增 `printLoginUrl` 配置行，说明发布地址不含凭据、登录链接的两种出口，以及无交互终端时的取舍。
- `packages/host/webserver/README.md`(+`.zh`)：说明 `openUrl` 字段的用途。
- `packages/host/authentication-token/README.md`(+`.zh`)：条目贡献方式改为「发布地址无令牌 + 交接地址带令牌」。
- `docs/subsystems/web-server.md`(+`.zh`)、`apps/cli/reference/README.md`(+`.zh`)：同步接口与 CLI 说明。
- 新增升级指南 `docs/upgrade-guide/v0.2.3-alpha.2/web-startup-login-link/guide.md`(+`.zh`)：地址行与登录链接行的迁移步骤，以及自定义 `webserver/entry-url` 监听器把凭据从 `url` 移到 `openUrl`。
- 重新生成 `docs/cli-help.md`、`docs/config-catalog.md`、`docs/event-producer-consumer.md`（+`.zh`）与 `packages/extensions/tool-cordis/src/api-catalog.ts`。

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 输出被重定向到文件/管道 | 地址行无 `?token=`；不打印登录链接；打印「redirected output carries no one-time login link」 | `keeps the launch token out of redirected startup output` |
| 部署显式要求打印登录链接 | 打印 `dsh web login link: <url>` 与「anyone who reads this output」提示行 | `prints the login link when the deployment asks for it` |
| 交互式终端 | 打印登录链接行，操作者点开完成一次 sign-in 交换 | `prints the advertised address and opens the credential-bearing entry`、`honors no-open while still printing the login link` |
| 默认浏览器交接 | 打开的是带令牌的交接地址（`openUrl`），不是打印出去的无凭据地址 | `prints the advertised address and opens the credential-bearing entry`、`prints all contributed entries and opens only the first eligible entry` |
| `--no-open` 与登录链接并存 | 不打开浏览器，但交互终端仍打印登录链接 | `honors no-open while still printing the login link` |
| CLI `--print-login-url` | 服务值 `printLoginUrl` 为 `true`；帮助文本列出该选项 | `publishes --print-login-url for a deployment without an interactive terminal` |
| 交互终端判定本身 | 返回布尔值；管道下为 false、tty 下为 true（实测） | `reports whether process output is an interactive terminal` |
| SSH 会话 | 打印无凭据地址、不打印登录链接、不打开浏览器 | 既有用例 `prints without opening when %s marks SSH`（断言改为不含令牌） |
| 另一个 provider 先贡献条目 | Remote 连接仍取到正确的带令牌登录地址 | `keeps the login link when another provider published an entry first` |
| 401 响应 | 文案指向启动输出中的一次性登录链接 | `packages/host/authentication-token/tests/browser-auth.host.spec.ts` |
| 令牌插件的条目贡献 | 发布地址无令牌、交接地址带令牌 | `packages/host/authentication-token/tests/plugin.host.spec.ts` |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `packages/bundle/web-app/tests/startup.host.spec.ts` | 新增 4 例（交互判定、重定向输出无令牌、显式打印登录链接、`--no-open` + 登录链接）；既有 5 例改为断言无凭据地址与登录链接行 |
| `packages/bundle/web-app/tests/startup.spec.ts` | 新增 `--print-login-url` 一例；既有用例的服务值断言补 `printLoginUrl` |
| `packages/bundle/web-app/tests/web-app.spec.ts` | 10 处 `new Config({...})` 补 `printLoginUrl: false`；`stdoutIsInteractive` 打桩为非交互 |
| `packages/client/remote-connection/tests/login.host.spec.ts` | 新增「其他 provider 先贡献条目」一例；`mount()` 增加 `earlierEntry` 参数 |
| `packages/host/authentication-token/tests/plugin.host.spec.ts`、`browser-auth.host.spec.ts` | 条目贡献形态与 401 文案 |

命令与结果（本地运行）：

```
pnpm exec vitest run --maxWorkers=2 \
  packages/bundle/web-app packages/host/authentication-token packages/host/webserver packages/client/remote-connection
  Test Files  32 passed (32)
  Tests  524 passed (524)

pnpm exec vitest run --maxWorkers=2 --coverage \
  --coverage.include='packages/bundle/web-app/src/**/*.ts' \
  --coverage.include='packages/host/authentication-token/src/**/*.ts' \
  --coverage.include='packages/host/webserver/src/**/*.ts' \
  --coverage.include='packages/client/remote-connection/src/**/*.ts' \
  packages/bundle/web-app packages/host/authentication-token packages/host/webserver packages/client/remote-connection \
  packages/api/gateway packages/client/connection packages/host/frontend-static
  Test Files  62 passed (62)
  Tests  1167 passed (1167)
  Statements   : 100% ( 1786/1786 )
  Branches     : 100% ( 1153/1153 )
  Functions    : 100% ( 358/358 )
  Lines        : 100% ( 1486/1486 )

pnpm exec oxlint packages/bundle/web-app packages/host/authentication-token packages/host/webserver packages/client/remote-connection
  exit 0

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped
```

红绿证据（先写失败测试）：新测试写好后，用 `git stash push` 只回退 5 个源文件（`packages/bundle/web-app/src/index.ts`、`packages/bundle/web-app/src/startup.ts`、`packages/host/authentication-token/src/index.ts`、`packages/host/authentication-token/src/browser-auth.ts`、`packages/host/webserver/src/index.ts`），保留测试不变重跑，出现 **12 处失败**（web-app 的 `startup.host.spec`/`web-app.spec`、authentication-token 的 `plugin.host.spec`/`browser-auth.host.spec`），失败点正是「打印行含 `?token=`」；恢复源文件后全绿。

补充说明：本 PR 未在本地跑 `build:artifacts` 后的构建产物 e2e（`apps/cli/tests/built-bin.e2e.ts`、`packages/api/remotes/tests/built-lib.e2e.ts`、web/profiles 的 expected e2e）。这些用例已按新的输出形态更新（`built-bin.e2e.ts` 断言启动行匹配 `dsh web: http://127.0.0.1:<port>/` 且 `not.toContain('?token=')`，web 侧用例改用 `--print-login-url` 取登录链接），构建与整轮 e2e 交由 PR CI。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent verified the reported chain against the code and pinned the exposure to the single printed startup line (the token plugin put the signed address in `WebEntryUrl.url`, and WebApp printed it verbatim), while `DSH_WEB_URL` and the agent runtime context carried the clean root; it also confirmed the default-browser handoff never used the process output; the author chose the fix direction (print the clean URL only) after the Agent's analysis. |
| design 方案设计 | copilot 人工把关 | 80% | The Agent proposed separating the published address from the handoff address (`WebEntryUrl.openUrl`) and the author approved it, together with the six execution points: clean printed URL, out-of-band browser handoff, a human sign-in path (interactive terminal or `--print-login-url`, plus the GUI copy-link entry), tests first, targeted validation only, and a draft Discussion reply for review. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent wrote the failing tests first (12 red assertions with the sources stashed), then added coverage for the redirected-output case, the explicit opt-in, the CLI flag, the interactive-terminal probe, and the multi-provider entry list, and confirmed 100% per-file coverage with the suites that exercise the token plugin; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the source changes, the tests, the English and Chinese README and subsystem revisions, the upgrade guide, and the regenerated catalogs, and re-recorded the translation pairs. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
