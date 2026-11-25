## Motivation

`goal` 与 `conversation` 两个命名空间的非 CJK 词典把动作按钮文案机翻成了名词性翻译：英文 `Clear goal` 是动词（移除目标），而 fr/de/ru/es/pt 全部译成了「一个清晰的目标」；`composer`（消息输入框）在 ja/es/fr/de/ru/pt 的待答问题文案里全被译成「作曲家」；`Queue message` 在 es/fr/de/ru/pt 成了名词（「队列消息」而非「将消息加入队列」）。Discussion #14322 为俄语词典提交了六处修复补丁，本 PR 采纳其中四处，并把同一缺陷类扩展到其余词典：`Guardar gol`（足球的「进球」）、`Zielziel`/`Цель Цель`（重复词）、`hacer pregunta`/`respuesta`/`en attendant`/`warten`/`Mensagem de fila` 等同类小错，以及 `ui-file-drag` 插件元信息 ru.json 中的同款「композитор」。

Refs #14322

## Changes

**Interface changes**

无。词典的键集不变，仅字符串值修正。

**Behavior changes**

- `ui-goal`：ja/es/fr/de/ru/pt 六语修正 `action.clear` 为动词（`目標をクリア`/`Limpiar objetivo`/`Effacer l'objectif`/`Ziel löschen`/`Удалить цель`/`Limpar meta`）；修正 `objective.aria` 的重复词或歧义词（ja `目標の説明`、es `Descripción del objetivo`、fr `Contenu de l'objectif`、de `Zielbeschreibung`、ru `Описание цели`、pt `Conteúdo da meta`）；es `action.save` 由 `Guardar gol` 改为 `Guardar objetivo`，es/pt 的 `phase.*` 词条统一为各词典自己的 `objetivo`/`meta` 用词。
- `ui-conversation`：es/fr/de/ru/pt 的 `input.send.queue` 改为动词短语；ja/es/fr/de/ru/pt 的 `ask.pendingDetail` 把「作曲家」改回消息输入框（`メッセージ入力欄`/`campo de entrada del mensaje`/`champ de saisie du message`/`Nachrichteneingabefeld`/`поле ввода сообщения`/`campo de entrada da mensagem`）；es/fr/de/ru/pt 的 `ask.pending` 改为「工作已继续；仍可回答」语义（采纳 #14322 的 ru 文案 `работа продолжена; ещё можно ответить`）；ru `placeholder.steerQueue` 采纳 #14322 的 `отправляет все сообщения из очереди в текущий ход`，de 同款改为 `…steuert alle Nachrichten aus der Warteschlange ein`；es `ask.rowTitle`/`ask.reopen`、fr `ask.waiting`、de `ask.waiting` 修正为合规范的措辞。
- `ui-file-drag`：插件元信息 ru.json 描述中的 `композитор` 改为 `поле ввода сообщения`。
- zh/en 原文不变；未改动的词典条目保持不变。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-ui-goal` | goal 面板与命令输入 | 变更：六语词典动作与 aria 文案修正 |
| `dsh-ui-conversation` | 会话输入与队列 | 变更：五语（de/ru/pt 三处、ja/es/fr 各处）词典文案修正 |
| `dsh-ui-file-drag` | 文件拖拽插件 | 变更：ru 元信息描述用词修正 |

依赖边：无。

## Testing

**Test design**

词典值由 `satisfies Record<keyof typeof en, string>` 保证键集完备性（编译期）；文案正确性属于人工翻译评审项。本 PR 的可执行证据为：所有引用这些词典的包级测试不变通过（词典消费面不回溯破坏），且 `pnpm run lint`/`git diff --check` 通过。GUI 演示 GIF 不适用：改动仅是把已被报告为误译的静态字符串替换为正确译文，无交互行为变化；按惯例标注：本 PR 不附 GIF，因为演示只能展示一行文字的变化，且真机俄语环境录制无法额外证明译文的正确性。

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `pnpm exec vitest run packages/client/ui-goal packages/client/ui-conversation`（本地） | 67 files / 1064 tests 全部通过；词典类型约束编译通过 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/client/ui-goal packages/client/ui-conversation
  Test Files  67 passed (67)
  Tests  1064 passed (1064)

pre-push typecheck（完整 gate）
  ✔️ typecheck (31.99s)
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | The reporter supplied the six ru fixes; the Agent verified them and found the same defect class across ja/es/fr/de/pt plus ui-file-drag ru metadata; the author has not reviewed the extension. |
| design 方案设计 | auto 模型自主 | 95% | The Agent decided to adopt the reporter's four usable ru strings verbatim and extend the fix pattern to every affected locale rather than apply the six-string ru-only patch. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent set the evidence bar as unchanged consumer tests plus key-set compile checks, and ran them. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote all dictionary edits across three files and six locales. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
