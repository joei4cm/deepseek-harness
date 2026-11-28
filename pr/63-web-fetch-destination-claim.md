## Motivation

`#14448` 安全审计 HIGH #1 指出 `packages/bundle/base/cordis.patch.yml` 注释与 `web-fetch-http` 的 `validateFetchUrl` JSDoc 声称 anonymous fetch「只接受公开 HTTP(S) 目标、解析并校验每个目标、钉住每个实际连接」。该断言全仓只有这两处，而实现、套件与双语 README 一致地表明相反事实：套件显式断言 `localhost`/`127.0.0.1` 可抓取（`fetch-http.spec.ts:404`），README 明示「可以访问私有目标——loopback、内网与云元数据地址与其他主机一样会被抓取」（`tool-web` README:280、`web-fetch-http` README:136）。两条过时断言不修复代码，却会误导下一次安全审查与维护者——评论声称存在一个不存在的 SSRF 防线。本 PR 按审计的「documentation is wrong」分支，把这两处文档与已测试的真实边界对齐。

Refs deepseek-ai/deepseek-harness#14448。上游不接受外部 PR，本分支位于 fork；`#14448` 下未发布回复（等待作者授权）。

## Changes

**Interface changes**

None。未改配置键、公共导出、协议或持久化格式。

**Behavior changes**

- 文档行为：base 组合注释改为陈述真实边界——anonymous fetch 接受任意 HTTP(S) 目标（含 loopback 与内网），URL 经校验、请求经进程级 dispatcher（已安装代理策略生效）；目标收敛需 `tools/pre-execute` 策略或网络隔离（与 `tool-web` README:280、 `web-fetch-http` README:136 措辞一致）。
- `validateFetchUrl` JSDoc 同步：「Public-address resolution and connection pinning run after this check.」改为「Every destination address is allowed; the system resolver chooses it.」
- 代码行为零变化；构建产物 `lib/types/policy.d.ts` 会随下次 build 自然跟随。

**Module responsibilities and dependencies**

None。

## Testing

**Test design**

纯文档改动：校验路径为链接/配对/包裹静态检查与既有套件不变性。行为事实本身已由既有测试锚定：`fetch-http.spec.ts` 的 `fetches a non-public destination at %s`（localhost/127.0.0.1）即新注释描述的行为，未改断言。

**Test entries**（本地）

- `pnpm run verify-cordis-config` — 424 config files passed（覆盖改动后的 patch.yml 解析与依赖完整性）。
- `pnpm exec oxlint packages/bundle/base packages/web/web-fetch-http` — 通过。
- 行为锚定用例 `fetch-http.spec.ts` 未改动；改动为注释/JSDoc 文本，无可运行断言新增。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 逐项核对 #14448 HIGH 判定，定位该条为文档-实现不一致；用户仅设目标 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择审计给出的「documentation is wrong」分支而非加 denylist，因套件与双语 README 明示内网可达是有意设计 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 以既有 localhost 抓取断言作为行为锚定，选 config 校验与 lint 为验证项 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 写全部文档改动 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
