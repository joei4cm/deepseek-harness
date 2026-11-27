## Motivation

Web 启动诊断不给出肇事插件的真实错误：第三方插件的 bundle 脚本解析失败或执行时抛出时，浏览器报出的错误（如 `Uncaught SyntaxError: Unexpected token ':'`）只存在于渲染进程控制台，启动审计给无 fiber 条目的原因只有 `loaded without registering "<id>" via __ModuleLoader__.load`（Discussion #14429）。

定位时确认：报告在 0.2.2-rc.1 观察到的「无辜插件被点名」在当前 master 已结构性解决——批脚本死亡后，未注册的每一行都会落到各自的单资源 URL（`arrive` 的 fallback），无辜行恢复激活、不进报告；肇事行的导入错误以自己的 id 记录（`recordingImportError`），报告正确指向它。剩余缺口是消息质量。真实 Chromium 探针表明：经典 `<script src>` 解析失败或执行时抛出时，元素触发的是 `load` 而不是 `error`，错误只以 `window` 上的 `ErrorEvent` 出现，其 `filename` 等于脚本的解析后 URL；元素自身的 `error` 事件只在网络或加载失败时触发且不带消息。页面传输（`loadPageBundle`）此前不监听 `window` 错误，所以脚本「成功加载」，错误文本丢失。

## Changes

**Interface changes**: None。`ScriptExecutionError` 只在包内导出给 `system.ts`，未进入包的公开入口；`ScriptRealm.execute` 契约不变。

**Behavior changes**:

- 默认页面传输在脚本元素存活期间监听 `window` 的 `error` 事件，只收集 `filename` 等于本脚本 URL 的事件；元素 `load` 时若收集到错误，则以 `ScriptExecutionError` 拒绝：`client-modules: bundle script <url> raised an execution error: Uncaught SyntaxError: Unexpected token ':'`。该文本经 `arrive` 进入该行的导入错误记录与 Web 启动报告（`import failed: …`）。其他脚本的 window 错误被忽略；无消息的同源错误记为 `uncaught error without a message`。
- 模块系统把 `ScriptExecutionError` 当作「脚本已执行」：批 URL 记为已执行并失败，不重试、不重放（重放会在首个重复注册处停住），每条缺失行照旧落到自己的单资源 URL；执行出错前已注册的行保持可用。元素 `error` 事件仍是传输失败，照旧重试一次。
- 载体提供 `loadBundle` 时（WebWorker 预览）不经过该传输，行为不变。
- `packages/client/modules` README 中英对照段落补充上述执行错误语义，并重新记录配对哈希。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**（行为矩阵）：

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 脚本解析失败（window `ErrorEvent` + 元素 `load`） | 传输 resolve，记录只有 `loaded without registering …` | 以 `ScriptExecutionError` 拒绝，记录含浏览器消息 | main-realm 用例「carries the browser script error text…」；loader 用例「captures script execution errors…」 |
| 批脚本执行出错后的 fallback | 批 URL 加载一次，行回落单资源 URL | 不变：请求序列严格为 `[批 URL, 单资源 URL]`，不重试、不重放 | loader 用例「captures script execution errors…」断言请求序列 |
| 批脚本注册了部分行后抛出 | 已注册行可用，其余行回落 | 不变：已注册行导入成功，未注册行只多一次单资源请求 | loader 用例「keeps a row the batch registered…」 |
| 其他脚本的 window 错误 / 无消息错误 | 不收集 | 忽略他人错误；本脚本无消息错误给出固定文本 | main-realm 用例「ignores window errors from other scripts…」 |
| 元素 `error`（网络/404） | `failed to load`，重试一次 | 不变 | main-realm 用例「reports a script element error as a load failure」；既有 default-transport 失败用例未改 |

**Test entries**:

- 本机 `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run packages/client/modules/tests --maxWorkers=2 --coverage --coverage.include=packages/client/modules/src/client/main-realm.ts --coverage.include=packages/client/modules/src/client/system.ts`：8 文件 / 274 用例全部通过，两个文件覆盖率 100%。
- 负控：把 `main-realm.ts` 与 `system.ts` 还原为 `origin/master` 版本，新增的执行错误用例失败（2 failed / 270 passed，当时共 272 用例），恢复修复后全部通过。
- 真实 Chromium（仓库声明的 Playwright，无头、路由到本地桩脚本）运行本分支的 `loadPageBundle`：`const x = ;` 得到 `raised an execution error: Uncaught SyntaxError: Unexpected token ';'`；`throw new TypeError("boom")` 得到 `raised an execution error: Uncaught TypeError: boom`；正常脚本 resolve；404 得到 `failed to load`。
- 本机 `pnpm exec vitest run packages/client/web/tests/boot-client.client.spec.ts --maxWorkers=2`：14/14 通过（该 spec 的导入错误为手写桩文本）。
- 本机 `pnpm run lint`、`verify-translation-pairing`、推送钩子 typecheck（5 项门禁）通过。
- 未运行 `test:web` 浏览器回放；快照与 ARIA 期望中无钉住旧文本的条目。上游不接受外部 PR，分支暂存于 fork，无 CI 结果。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 比对 Discussion #14429 与 master，判定结构问题已解决、剩余缺口是错误文本，并用真实 Chromium 确认错误只经 window 事件到达。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择在页面传输内按 filename 收集 window 错误，并让模块系统把执行错误视为已执行、不重放，不改 ScriptRealm 契约。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计传输与回落用例、负控和真实 Chromium 探针，跑模块全套覆盖率、boot-client spec 与 lint/typecheck。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写传输、模块系统、测试与 README 中英改动。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
