## Motivation

Composer 的 `activity` 统计控件把全会话累计的解码 token 除以累计解码耗时——`sessionStats` 投影的作用域写在自己的类型里（whole-log、与客户端分页无关），这是刻意设计；而对话框行标签写作「输出速度（TPS）」，读起来像当前速度。长会话里这个累计均值只会缓慢下滑，用户据此判断推理服务在降速。Refs #14297

## Changes

**Interface changes**: None。

**Behavior changes**:
- `stats.dialog.speed` 标签在全部 8 个语言字典（zh/en/ja/es/fr/de/ru/pt）中改为显式的全会话平均口径，例如英文 `Session-avg tokens per second (TPS)`、中文「会话平均输出速度（TPS）」，与同组 `stats.dialog.ttft` 的「平均」表述一致。
- `ui-chat` 双语 README 对同一读数的描述同步为「全会话平均输出速度」。
- 数值、计算口径、投影结构均不变：`sessionStats` 仍是 whole-log 累计，投影 `stateVersion` 不动，无持久化类型变更。
- 最近窗口口径不进入 harness：投影有意不携带逐步历史，而从已加载节点做尾部折叠在分页下不稳定（投影的存在意义就是分页无关），因此窗口读数属于可替换的 `conversation.composer.dock` 条目这一插件层关注点。

**Module responsibilities and dependencies**: None。

**Existing test behavior**：`chat-stats.client.spec.tsx` 两处英文断言从 `Tokens per second (TPS)20 tok/s` 更新为 `Session-avg tokens per second (TPS)20 tok/s`——原断言钉住的正是被改写为误导性的文案，随本次文案修正同步更新。

**GUI demonstration**: 未嵌入 GIF。本次只改语言字典中的一个对话框行标签与两段 README 描述，无布局、交互或状态变化；`chat-stats.client.spec.tsx` 直接断言渲染后的对话框文本，且仓库内没有浏览器快照钉住该字符串（已检索 `apps/web` e2e 与 `snapshots/`），故不满足 record-browser-gif 要求的真实服务器/真实模型录制条件。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 详细模式打开会话统计对话框 | 行标签 `Tokens per second (TPS)`，读作当前速度 | 标签声明全会话平均口径 | `chat-stats.client.spec.tsx` 两处断言 |
| 简洁模式 | 仅显示裸数字（无标签） | 不变 | 既有 `compact keeps only speed and cache hit` 用例仍绿 |
| 数值与投影 | 累计口径 | 不变 | 既有 44 用例全绿，含投影分页/窗口一致性用例 |
| 其他 7 个语言字典 | 无口径说明 | 同口径改写 | 类型 `satisfies` 键集不变 + `verify-client-ui-i18n` |

**Test entries**:
- `pnpm exec vitest run packages/client/ui-chat/tests/chat-stats.client.spec.tsx` — 44 通过（本机）。
- `pnpm run test:gui` — 834 个文件、14763 个用例通过、2 跳过（本机，187s）。
- 推送时 pre-push typecheck：5 gates 全过（本机，115s）。
- `pnpm run verify-client-ui-i18n` — 1423 个 Client 源文件通过（本机）。
- `pnpm run verify-translation-pairing packages/client/ui-chat/README.md` — 1 对 README 配对一致（本机）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 在源码中确认累计口径是投影的刻意作用域，锁定可行动余量为标签口径。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择 reporter 的方案 B 并论证窗口口径为何属于插件层而非 harness。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 运行 owning spec、GUI 内环、i18n 与配对检查，并确认无浏览器快照钉住该串。 |
| implementation 技术实现 | auto 模型自主 | 100% | 全部字典、README 与测试更新由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
