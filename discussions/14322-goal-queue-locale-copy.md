<!--
状态：草稿，未发布。
用途：Discussion #14322 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/client-goal-queue-locale-copy` 分支，未向上游开 PR。
-->

# English reply (for posting to Discussion #14322)

Thank you for the careful report and the reviewable patch. I verified each of your six Russian fixes against the call sites and adopted four of them verbatim (`objective.aria`, `action.clear`, `placeholder.steerQueue`, `input.send.queue`, `ask.pending`, `ask.pendingDetail` — with the six strings in effect as you wrote them).

While checking your table against the dictionaries I found the same defect class in the other locale files, so on a fork branch (`fix/client-goal-queue-locale-copy`) the fix is applied systematically rather than only to ru:

- **`action.clear`** is a verb ("remove the goal") but was an adjective in every non-CJK dictionary: fixed to `Effacer l'objectif` (fr), `Ziel löschen` (de), `Limpiar objetivo` (es), `Limpar meta` (pt), `目標をクリア` (ja), `Удалить цель` (ru).
- **`composer`** (the message input field) was the music "композитор/compositor/compositeur/Komponist" in `ask.pendingDetail` for ja/es/fr/de/ru/pt — all now say "the message input field" in their own words. The same mistranslation also lived in `ui-file-drag`'s `locale/ru.json` plugin metadata and is fixed there.
- **`input.send.queue`** was a noun ("queue message") in es/fr/de/ru/pt; all now use a verb phrase like your `Добавить сообщение в очередь`.
- **`objective.aria`** had duplicated words in de (`Zielziel`) and ru (`Цель Цель`), both now meaning "goal description"; es/fr/pt/ja were normalized similarly.
- Related strays fixed along the way: es `action.save` `Guardar gol` → `Guardar objetivo` (gol = football goal); es/fr/de/pt `ask.pending` normalized to "work continued; reply still possible"; es `hacer pregunta`/`respuesta`, fr `en attendant`, de `warten`, de `steerQueue` wording, and pt `Mensagem de fila`.

`zh`/`en` and all untouched keys are unchanged; `satisfies Record<keyof typeof en, string>` keeps the key sets complete at compile time, and the consumer test suites (1064 tests across ui-goal + ui-conversation) pass unchanged.

# 中文对照（仅供作者阅读，不发布）

感谢细致的报告和可直接评审的补丁。我逐条对照调用点核实了你的六处俄语修复，并按你给的原文采纳（`objective.aria`、`action.clear`、`placeholder.steerQueue`、`input.send.queue`、`ask.pending`、`ask.pendingDetail` 六串全部生效）。

在把你的表格与各词典对照时，我发现同一类缺陷出现在其他语言的词典里，因此在 fork 分支（`fix/client-goal-queue-locale-copy`）上按缺陷类系统性修复，而非只改 ru：

- **`action.clear`** 是动词（移除目标），但所有非 CJK 词典都译成了形容词：fr `Effacer l'objectif`、de `Ziel löschen`、es `Limpiar objetivo`、pt `Limpar meta`、ja `目標をクリア`、ru `Удалить цель`。
- **`composer`**（消息输入框）在 ja/es/fr/de/ru/pt 的 `ask.pendingDetail` 里全是「作曲家」——现在统一改为「消息输入框」各自的表述。同一误译还藏在 `ui-file-drag` 的 `locale/ru.json` 插件元信息里，一并修复。
- **`input.send.queue`** 在 es/fr/de/ru/pt 是名词（「队列消息」）；全部改为与你的 `Добавить сообщение в очередь` 同类的动词短语。
- **`objective.aria`** 在 de（`Zielziel`）与 ru（`Цель Цель`）是重复词，均改为「目标描述」语义；es/fr/pt/ja 同步规范。
- 顺带修正的同类散错：es `action.save` `Guardar gol` → `Guardar objetivo`（gol 是足球进球）；es/fr/de/pt `ask.pending` 统一为「工作已继续；仍可回答」；es `hacer pregunta`/`respuesta`、fr `en attendant`、de `warten`、de `steerQueue` 措辞、pt `Mensagem de fila`。

`zh`/`en` 与未触及的键不变；`satisfies Record<keyof typeof en, string>` 在编译期保证键集完备，消费方测试套件（ui-goal + ui-conversation 共 1064 项）无回归通过。
