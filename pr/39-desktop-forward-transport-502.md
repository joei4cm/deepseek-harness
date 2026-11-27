## Motivation

Desktop 主进程的 `forwardWebRequest` 把应用窗口的每个 HTTP 请求代理给归属的 Web Host，但 `fetch` 的 rejection 直接穿透 `protocol.handle` 处理器向上冒泡。主进程与 Host 之间发生一次连接重置（ECONNRESET）时，rejection 变成未处理异常，被 `installFailLoud` 映射为 `proc.exit(1)`——一个可恢复的网络抖动让整机应用反复弹出崩溃对话框，报告环境（国内直连 Windows）下约每 30 秒崩溃一次，普通用户无法自行恢复。Refs #14271

## Changes

**Interface changes**: None。

**Behavior changes**:

- 主进程到 Host 的转发在传输失败（连接重置、拒绝、中止等 `fetch` rejection）时返回 `502` 响应，不再向协议处理器冒泡 rejection；与处理器既有的 `503`（Host 未就绪）、`404`、`403` 合成响应一致。
- 传输失败经 `console.error` 记录（消息带请求方法与路径）；渲染侧已中止的请求不记录——中止本身即说明。
- 已发送字节不变：流式转发、请求中止、连接级响应头丢弃、插件 bundle 的 `no-store` 改写均保持原状。一次 502 的语义是「这一跳失败」，应用保持运行，渲染侧可重试。
- 报告语境中第二处可疑 fetch（启动认证）在 master 上已经收敛为 `.deliver(...).catch(...)`，不需要改动。

**Module responsibilities and dependencies**: None。改动只落在 `apps/desktop` 的 `src/web-document.ts` 与既有测试文件，没有包间依赖边变化。

**文档**: `apps/desktop` README 双语对在转发描述中补充 502 契约，已重录 translation pairing。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| Host 连接被重置（ECONNRESET 等任意 fetch rejection） | rejection 穿透 `protocol.handle`，到达 fail-loud 钩子 → 进程退出 | 返回 `502`，`console.error` 记录失败 | `answers a transport failure as 502 instead of rejecting through the protocol handler` |
| 渲染侧已中止的请求遇到传输失败 | 同上 | 返回 `502`，不记录日志 | `does not log the transport failure of a request the renderer already aborted` |
| 正常转发（流、凭据、头处理、bundle 缓存头） | 既有契约 | 不变 | 既有转发用例全绿 |

负控：把 `apps/desktop/src/web-document.ts` 备份到 /tmp 后用 `git checkout origin/master -- <path>` 还原到修复前，502 用例以 `TypeError: fetch failed` 穿透失败；恢复实现后全绿。

**Test entries**:

- `pnpm exec vitest run apps/desktop/tests/ --maxWorkers=2` — 168 个文件、2119 个用例通过（本机）。
- `pnpm run build` — 10 个 gate 通过（本机）。
- `pnpm run typecheck` — 5 个 gate 通过（本机）。
- `pnpm run lint` — 通过（本机）。
- `pnpm run doc-sync` — 41 个 gate 通过，2 个失败（本机）。两个失败为上游 master 既有问题，与本改动无关：`tool catalog` 报 `tool-working-directory` 未列入 `scripts/gen-tool-catalog.ts` 的 `TOOL_PACKAGES`；`package paths` 报 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/guide.md` 指向不存在的 `packages/experimental/ptc-runtime-python/README.md`。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: copilot](https://img.shields.io/badge/䷼%20AI--DECLARATION-copilot-fee2e2?labelColor=fee2e2)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `copilot`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 按报告者与讨论中确定的逃逸点复核：`forwardWebRequest` 是主进程里唯一没有接收方的 `fetch`，另一处启动 fetch 在 master 已有 `catch`。 |
| design 方案设计 | copilot 人工把关 | 60% | 修复方向（在请求归属方接住 rejection、应答 502）由讨论中的既有回复给出，报告者认可；Agent 确定降级语义与日志区分（已中止请求不记录）。 |
| testing 验收测试 | auto 模型自主 | 100% | 设计两个覆盖用例并做负控（还原修复前源码，502 用例以 rejection 穿透失败）。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 完成全部源码、测试与双语 README 改动；作者未做 diff 审阅。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
