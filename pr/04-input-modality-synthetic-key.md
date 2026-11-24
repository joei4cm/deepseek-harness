## Motivation

`ui-primitives` 的 `input-modality` 在 window 上挂了一个捕获阶段 keydown 监听器，判断键盘导航键时直接调用 `event.key.startsWith('Arrow')`，没有先检查 `key` 是否存在。真实键盘事件总带字符串 `key`，但浏览器扩展和自动化工具常派发 `new Event('keydown')` 这类不含 `key` 的合成事件——一旦模块被导入，页面上出现这种事件就会抛 `TypeError: Cannot read properties of undefined (reading 'startsWith')`。由于监听器挂在 window 且模块在任何引用它的页面都会被加载，报错面很宽（报告者的前端错误收集器在没有渲染聊天 UI 的页面上也收到）。

Refs #14246

## Changes

**Interface changes**

无。导出面（`INPUT_MODALITY`、`INPUT_MODALITY_ATTRIBUTE`、`pointerModality()`、`touchModality()`）不变。

**Behavior changes**

- keydown 监听器在读取 `event.key` 前先确认它是字符串；不含 `key` 的合成事件按「非按键输入」处理：清掉 pending key（`keyFocusOrigin`）并返回，不再抛错。
- 该事件与 IME composition 按键走同一条早退分支，语义一致：都不当作焦点导航键，且都清除等待焦点变化的 pending key。
- 除此之外行为不变：真实按键仍按 Tab/方向键/Home/End/PageUp/PageDown 切换 modality，`pointerType = null` 仍在事件到达时清零（报告者建议的写法与此一致）。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-client-ui-primitives` | Web UI 的纯 React 原子与文档级输入跟踪 | 变更：keydown 监听器容忍无 `key` 的合成事件 |

依赖边：无新增或删除。

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 无 `key` 的合成 keydown | 不抛错，不改变 modality，pending key 被清除 | `ignores synthetic keydown events that carry no key` |
| 合成事件之后的真实按键 | modality 恢复为 keyboard | 同上（同测内后续 `press('Tab')` 断言） |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `ignores synthetic keydown events that carry no key` | 裸 `Event('keydown')` 不抛错、模态保持 pointer；随后的真实 Tab 按键仍恢复 keyboard 模态 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/client/ui-primitives/tests/input-modality.client.spec.ts
  Test Files  1 passed (1)
  Tests  12 passed (12)

pnpm exec vitest run packages/client/ui-primitives
  Test Files  90 passed (90)
  Tests  2106 passed (2106)

pnpm exec tsc -b tsconfig.client.json
  exit 0

pnpm exec tsc -b tsconfig.host.json
  exit 0
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent verified the report against current source and selected this Discussion from its own scan of candidates; the author pre-approved candidate selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent adopted the reporter's suggested guard, merged it with the existing isComposing early-return to keep the pending-key clearing symmetric; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent wrote the regression test and chose the pointer-then-keyboard sequence that proves the event neither throws nor latches keyboard modality; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the guard, the regression test, and this description. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
