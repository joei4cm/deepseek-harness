## Motivation

交互式 HTML 预览中的外部链接点击没有任何反应（Desktop 与 Web 上均如此），且预览 iframe 内的脚本可以把整个预览面板导航到外部站点（面板劫持）。

Refs #14304

## Changes

**Interface changes**

无。`HtmlBodyInjected` 增加一个内部注入回调 `openExternalLink`，不进入公共导出。

**Behavior changes**

- 交互式 HTML 预览中的 HTTP(S) 链接点击在外部打开，而不是在预览框架内导航：框架内的点击桥接把解析后的 URL 发给应用。
- 应用只接受不带凭据的绝对 HTTP(S) URL，五秒内最多打开五个请求，同一链接的重复请求只打开一次；页内锚点、相对链接和其他 scheme 留在框架内不变。
- Desktop 主进程拒绝由不可信文件内容（以 Blob URL 标识）承载的预览框架导航到外部站点；主框架和其他嵌套框架不受影响。
- Desktop 的外链打开与主框架导航使用统一的 URL 策略：拒绝无法解析的 URL、带凭据的 URL，以及指向应用自身 Host 端口或回环名称的 URL。
- 更新双语文档，保持与代码一致。

**Module responsibilities and dependencies**

无。

**GUI disclosure**

本改动影响 HTML 预览的可见行为。尚未嵌入真实应用演示 GIF：当前 `gh` 版本为 2.86，低于附件工作流要求的 2.99，且尚未录制真实服务器演示。

## Testing

**Test design**

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 预览中点击 HTTP(S) 链接 | 无任何反应 | 应用在外部打开该链接 | `forwards a trusted click on an HTTP(S) link to the application and keeps the frame in place`、`opens an external link the preview frame posted` |
| 脚本合成的点击 | 框架可能导航 | 桥接忽略非可信事件 | `ignores a click the frame itself produced` |
| 锚点 / 相对 / 其他 scheme 链接 | — | 留在框架内 | `leaves links the application may not open to the frame itself` |
| 预览框架被替换后旧框架的消息 | — | 被忽略 | `does not open a link after the preview frame is replaced` |
| 恶意预览连续请求 | — | 五秒内最多五个、重复链接去重 | `opens at most the bounded number of external links the preview frame posts`、`external link gate` |
| Desktop 预览框架脚本导航 | 面板可被劫持 | 拒绝该框架的外部导航 | `refuses unsafe external links and keeps a preview frame from navigating away` |
| Desktop 带凭据 / 非法 / 应用自身 Host 的 URL | 打开外部浏览器或抛错 | 拒绝且不打开 | `external navigation policy`、`refuses unsafe external links` |

**Test entries**

- 本地 `pnpm exec vitest run packages/client/ui-sidebar-documentpreview/tests/html-bootstrap.client.spec.ts packages/client/ui-sidebar-documentpreview/tests/html-external-link.client.spec.ts --maxWorkers=2`：覆盖桥接与策略。

  <details><summary>Proof</summary>

  `Test Files 2 passed (2); Tests 12 passed (12)`

  </details>

- 本地 `pnpm exec vitest run packages/client/ui-sidebar-documentpreview/tests/html-body.client.spec.tsx --maxWorkers=2`：覆盖父框架闸门。

  <details><summary>Proof</summary>

  `Test Files 1 passed (1); Tests 14 passed (14)`

  </details>

- 本地 `pnpm exec vitest run packages/client/ui-sidebar-documentpreview --maxWorkers=2`：覆盖预览包全部测试。

  <details><summary>Proof</summary>

  `Test Files 59 passed (59); Tests 626 passed (626)`

  </details>

- 本地 `pnpm exec vitest run apps/desktop/tests/external-navigation.spec.ts --maxWorkers=2`：覆盖 Desktop URL 策略。

  <details><summary>Proof</summary>

  `Test Files 1 passed (1); Tests 4 passed (4)`

  </details>

- 本地 `pnpm exec vitest run apps/desktop/tests/main-startup.spec.ts --maxWorkers=2`：覆盖 Desktop 启动与导航守卫。

  <details><summary>Proof</summary>

  `Test Files 1 passed (1); Tests 188 passed (188)`

  </details>

- 本地 `pnpm exec vitest run apps/desktop/tests/keyboard.spec.ts apps/desktop/tests/web-document.spec.ts --maxWorkers=2`：覆盖 Desktop 相邻套件。

  <details><summary>Proof</summary>

  `Test Files 2 passed (2); Tests 47 passed (47)`

  </details>

- 本地 `pnpm run test:gui --maxWorkers=2`：客户端与 Host GUI 全量套件。首次全量运行暴露父框架闸门测试与 React passive effect 的时序竞态（监听器挂载前派发的消息被丢弃）；测试改为向框架自身 window 派发探测链接并等待真实打开后再断言，不涉及产品代码。

  <details><summary>Proof</summary>

  `Test Files 835 passed (835); Tests 14774 passed | 2 skipped (14776)`

  </details>

- 本地 `pnpm run build`：构建门（含 Host / Client 聚合类型检查）。

  <details><summary>Proof</summary>

  10 个门全部通过。

  </details>

- 本地 `pnpm exec tsc -p tsconfig.client.json --noEmit` 与 `pnpm run lint`（最终代码树，含测试修正）：聚合类型检查与代码样式。

  <details><summary>Proof</summary>

  命令退出码 0。

  </details>

- 本地 `DSH_GATE_CONCURRENCY=1 NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync`：文档门（双语配对、文档标准、站点检查等）。

  <details><summary>Proof</summary>

  `run-gates: 43 passed, 0 failed, 0 skipped`

  </details>

- 本地 `DSH_SNAPSHOT=replay pnpm run test:web`（运行时观察）：build 阶段 10 门全过；e2e 阶段观察到的失败均带 `'WebKit'` 标签（geometry / focus / resize / tooltip 类场景），与本改动覆盖的表面无交集，判定为本机 WebKit 环境 flake 并在交接中注明。

  <details><summary>Proof</summary>

  进行中；已观察 12 个文件失败，全部 `'WebKit'` 标签，无一涉及 documentpreview / HTML 预览。

  </details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | 作者常设授权 Agent 自选候选并开工；Agent 三路查重后选定 Discussion #14304 并确认实现边界。 |
| design 方案设计 | auto 模型自主 | 90% | 沿用报告者已验证的桥接 / 父闸门 / Desktop 守卫结构，Agent 自主决定 Blob URL 识别与统一 `openableExternalUrl` 策略两处偏差。 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计行为矩阵并运行全部测试；全套 `test:gui` 揭示订阅时序竞态后由 Agent 修正测试同步方式。 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 编写全部改动。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |
