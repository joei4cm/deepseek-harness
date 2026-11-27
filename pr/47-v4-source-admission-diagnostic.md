## Motivation

失败工具的结果让轮次以 `SessionFormatError: format v4 message requires a producer-owned source kind` 结束，且同一会话后续每一轮都以同一错误失败、重启前无法使用（Discussion #14411，桌面 0.2.2-rc.5）。写入路径的准入拒绝（`assertV4SourceRowAdmission`）只在消息来源为退役的 `kind: 'plugin'` 时抛出，因此报告者的运行时确实写入了一条带退役来源的消息行；但该错误不带事件类型与观察到的来源，混在 `encodeEventBatch` 批量写入里无法定位是哪条行、哪个组件写出的。我们逐一核查了 master 与 `dsh-v0.2.2-rc.5` 两棵树中全部六类受检事件（`user/message`、`system/message`、`assistant/message`、`tool/result`、`agent/inbox/spliced` 的 `inserted`、`session/title-llm-request`）的生产追加点：工具结果（批次提交、压缩剪除替换、中断恢复）、步骤上下文与助手消息、收件箱拼接（控制器侧 `{kind:'user', rpcId}`）、标题请求（`dsh-session-title-llm`）、压缩检查点（`compact-checkpoint`）——全部携带生产者自有来源，树内没有任何运行时代码写出 `kind: 'plugin'` 的消息来源（V2→V3 迁移是唯一产出者，属于迁移层产物）。

## Changes

**Interface changes**: None。

**Behavior changes**:

- V4 来源准入拒绝的 `SessionFormatError` 消息现在携带定位信息：受检事件的类型与观察到的来源的 JSON 摘录（`JSON.stringify` 输出为 ASCII，按 200 字符截断不会劈开码点；来源缺失时记 `missing`），形如 `format v4 message requires a producer-owned source kind (tool/result: {"kind":"plugin","plugin":"stale-bundle"})`。既有句子保持为前缀，现有按子串断言的用例不受影响。
- 准入行为本身不变：仍拒绝缺失、畸形、空与退役的来源 kind；读取路径仍只拒绝退役包装。
- 该诊断把「批量写入中某条行来源可疑」变成「哪类事件、哪个插件名」——若 #14411 的报告者环境存在树外或过期捆绑插件（#14408 记录了桌面自动更新会把 profile 插件留在过期的精确固定版本上），升级后下一次复现将直接给出插件名。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**:

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 完整准入遇到缺失来源 | 报裸句子 | 报 `(user/message: missing)` | 新增 `message-sources.spec.ts` 用例 |
| 完整准入遇到空 kind | 报裸句子 | 报 `(user/message: {"kind":""})` | 同一用例 |
| 写入路径拒绝 `tool/result` 上的退役包装 | 报裸句子，批量中无法定位 | 报 `(tool/result: {"kind":"plugin","plugin":"stale-bundle"})` | 新增经 `encodeCurrentEvent` 的用例（即 #14411 栈上的路径） |
| 既有拒绝矩阵（六类槽位、畸形不完整行） | 不变 | 不变 | 既有用例 |

负控：把 `src/message-sources.ts` 还原为 `origin/master` 后，两条新用例失败（消息缺少 `(<type>: <source>)` 部分）；还原补丁后全部通过。

**Test entries**:

- 本机 `pnpm exec vitest run packages/session/session-format-v3-to-v4/tests/ packages/session/session-persistence-jsonl/tests/ packages/session/session-persistence-sqlite/tests/ --maxWorkers=2`：69 文件 / 1504 用例通过（1 条既有跳过）。
- 本机同命令加 `--coverage --coverage.include='packages/session/session-format-v3-to-v4/src/message-sources.ts'`：该文件语句 / 分支 / 函数 / 行覆盖率 100%。
- 本机 `pnpm run lint`：通过。
- 本机 typecheck（pre-push 钩子 5 项门禁）：通过。
- 未验证：#14411 的原始复现环境（桌面 rc.5 + 报告者组合）无法在本机重建；本改动是诊断增强，不改变该环境的行为，只让下一次复现可定位。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据栈帧确定写入路径只对 `kind: 'plugin'` 抛错，逐一核查两棵树的全部生产追加点并排除树内来源。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「保留既有句子为前缀，追加事件类型与有界来源摘录」，不改准入行为与错误类别。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 补诊断断言用例并跑负控、三个持久化包全量与覆盖率。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写消息增强与用例。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
