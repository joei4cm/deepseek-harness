## Motivation

Web 启动诊断只说「加载失败」：第三方插件的 bundle 脚本解析失败时，浏览器报出的真实错误（如 `SyntaxError: Unexpected token ':'`）只存在于渲染进程控制台；启动审计对无 fiber 条目给出的原因是 `client-modules: bundle script <url> failed to load`（传输失败）或 `loaded without registering …`（脚本执行中途抛出），弹窗或警告里没有任何指向肇事插件的文本（Discussion #14429）。

定位时确认：报告在旧版（0.2.2-rc.1）观察到的「无辜插件被点名」在当前 master 已结构性解决——批脚本死亡后，未注册的每一行都会落到各自的单资源 URL（`arrive` 的 fallback），无辜行恢复激活、不进报告；无 fiber 的肇事行携带以自己 id 记录的导入错误（`recordingImportError`），报告正确指向它。剩余缺口是消息质量：页面传输（`loadPageBundle`）在脚本 `error` 事件里丢弃了浏览器的 `ErrorEvent.message`，导致报告文本缺少唯一的控制台外错误副本。

## Changes

**Interface changes**: None。

**Behavior changes**:

- 页面脚本传输的加载失败文本在浏览器报出消息时追加该消息：`client-modules: bundle script <url> failed to load: SyntaxError: Unexpected token ':'`。该文本经 `arrive` 的尝试链进入该行的导入错误记录与启动报告（`import failed: …`），弹窗/警告中即可看到真实语法错误。
- 无消息的失败（网络类）保持原文本不变；`{ once: true }`、节点移除、重试与 fallback 语义全部不变。
- 脚本已执行但中途抛出（runtime throw）仍按既有设计让传输 resolve——重放会再次执行顶层代码并在首个重复注册处停住——因此该类错误的原文仍只在控制台；此余量在讨论稿中如实说明，留给维护者裁决是否扩宽 ScriptRealm 契约。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**（行为矩阵——诊断文本变更）：

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 脚本 `error` 事件带浏览器消息（解析错误） | 文本只有通用「failed to load」 | 文本追加 `: <浏览器消息>`，且进入 `importError` 记录 | 新增页面传输用例（消息情形）：`modules.import` 拒绝文本与记录均含消息 |
| 脚本 `error` 事件无消息（网络失败） | 通用文本 | 不变 | 新增用例断言原文本与记录尾缀；既有 default-transport 失败用例改为按 DOM 契约派发 `ErrorEvent` |
| 批脚本解析失败后的无辜行 | 经单资源 fallback 激活，不进报告 | 不变 | 既有 fallback/部分注册用例全部通过 |

**Existing test behavior**: 既有「a script load failure is loud and removes the node」原来派发无消息的裸 `Event('error')`；按 DOM 契约（script 元素的 error 事件是 `ErrorEvent`）改为 `new ErrorEvent('error')`，断言文本不变。其余断言均未改动。

**Test entries**:

- 本机 `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run packages/client/modules/tests --maxWorkers=2`：8 文件 / 271 用例全部通过。
- 负控：把 `main-realm.ts` 还原为 `origin/master` 版本后，新增消息用例失败（该文件 1 failed / 6 passed），恢复修复后全部通过。
- 本机 `pnpm exec vitest run packages/client/web/tests/boot-client.client.spec.ts --maxWorkers=2`：14/14 通过（报告面不受影响；该 spec 的导入错误为手写桩文本，与生产文本解耦）。
- 本机 `pnpm run lint`：通过；推送钩子 typecheck：5 项门禁通过。
- 快照核对：`rg "failed to load"` 确认无快照或文档钉住旧文本（`boot-client.client.spec.ts` 的两处为桩文本，非生产输出）。
- 本分支无 CI/PR 结果：上游不接受外部 PR，分支暂存于 fork。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复核 Discussion #14429，逐条比对当前 master 的 arrive fallback、逐行导入记录、必选/可选审计与提案 1–3，判定报告的结构性问题已在 master 解决、剩余缺口是传输丢弃浏览器错误文本。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择不改 ScriptRealm 契约的最窄修法：仅在页面传输的失败文本中携带 `ErrorEvent.message`；runtime throw 的余量如实披露并留给维护者。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 新增两个传输用例、按 DOM 契约修正既有事件派发，跑模块全套、负控、boot-client spec 与 lint/typecheck。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写传输与测试改动。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
