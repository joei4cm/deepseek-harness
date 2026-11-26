## Motivation

一次模型请求以 HTTP 错误（如 401）结束后，输入框旁的上下文占用环从正常读数掉到 0%，看起来像整个对话历史被清空。根因：适配器的 in-stream error 路径把从未被任何 chunk 更新过的全零 usage 骨架塞进错误结算，`contextPressure` 投影把它当作真实采样——`pressureTokens` 被覆盖为 0，采样点 `sampledSurfaceTokens` 同步推进到当前 surface，差值修正项因此抵消归零，`projectedTokens` 显示 0%。数据没有丢失，下一次成功请求会自行恢复，但 0% 的观感足以让用户误以为会话损坏。Refs #14387

## Changes

**Interface changes**: None（投影的 wire 形状、字段语义与状态版本不变；`stateVersion` 保持 6/2——已污染的缓存状态在下一次真实结算到达时自行修正）。

**Behavior changes**:
- `contextPressure` 投影：只携带全零 usage 骨架的结算（prompt 侧与输出计数全为 0）不再算作用量报告——不覆盖 `pressureTokens`，也不推进 `sampledSurfaceTokens`，占用环继续显示上一次真实采样加其后 surface 增量。携带部分计数的结算仍正常采样（报告警示的「部分 token 已消耗后被拒」场景不误伤）。
- `tokenUsage` 投影：同一个 `usageOf()` 守卫同样生效——全零骨架不再落入 `last` 槽位记录一次空桶（报告的 §二「逐轮用量统计·轻微」污染一并消除）；累计总量改前改后不受影响。
- 重放旧版适配器写入的日志同样受益：零值骨架在折叠期被忽略，不依赖日志格式变更。
- JSDoc 与 token-meter README（英/中双语）补明该语义。

**Module responsibilities and dependencies**: None（改动只在 `dsh-token-meter` 的投影折叠、README 与规格内；无包间依赖变化，适配器与持久日志未动）。

## Testing

**Test design**（行为矩阵）：

| 场景 | 改前 | 改后 | 覆盖测试 |
|---|---|---|---|
| 失败结算携带全零 usage 骨架 | `pressureTokens` 覆盖为 0、采样点推进，`projectedTokens` 归零 | 忽略该样本：`pressureTokens` 保持上一次真实值，采样点不动，`projectedTokens` 继续计数 surface 增量 | `token-usage-projection.spec.ts` 新用例 'keeps the last real sample when a failed settlement carries a zero-usage skeleton' |
| 携带部分计数的结算（如仅 output） | 正常采样 | 正常采样 | 同用例末尾子断言（`inputTokens:0, outputTokens:6` → `pressureTokens: 0`） |
| 真实采样、重试、压缩、checkpoint | 原行为 | 原行为 | 既有 21 个用例全数通过，无期望变化 |

负控：把 `src/usage-projection.ts` 还原到 pre-fix 后重跑，新用例失败（观察到 `pressureTokens: 0`），确认覆盖该回归。

**范围说明**：修复放在投影层（报告建议 2+3 合并：守卫即隐含「不推进采样点」），选择理由：① 与提供方无关，覆盖所有走 in-stream error 路径的适配器；② 覆盖已写入持久日志的零骨架（含旧版本产物），适配器级修复无法回溯；③ 持久日志保持事件原文（adapters 记录什么就存什么）。残余项：日志仍记录该零值 usage chunk（忠实反映适配器输出），`turnUsage`/`deriveTurnTokenUsage` 的 `normalizeUsage` 仍接受零样本（不产生用户可见误读）；报告建议 1（适配器不落零值）与建议 4/5（前端区分零与未知）未实施。已污染缓存状态不迁移：下一次真实采样自行修正。

**Test entries**:
- `pnpm exec vitest run packages/llm/token-meter/tests --maxWorkers=2` — 6 个文件、138 个用例通过（本机）。
- `pnpm run typecheck` — 通过（本机）。
- `pnpm run lint` — 通过（本机）。
- `pnpm run doc-sync` — 43 个 gate 全过（本机）。
- 推送时的 pre-push typecheck — 通过（本机）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据报告的根因链在 master 逐行核对（`stream.ts` error case、`usageOf`、采样推进、视图换算），确认与文档一致。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 在报告五个建议中选定投影层守卫（覆盖旧日志、与提供方无关、不动持久格式），判定守卫应同时保护 `tokenUsage` 投影。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计新用例（真实采样→零骨架失败结算→部分计数采样）并以负控验证覆盖。 |
| implementation 技术实现 | auto 模型自主 | 100% | `isUsageSample`/`usageOf` 守卫、JSDoc、双语 README 与测试由 Agent 编写。 |
| review 评审处理 | n/a 暂不适用 | — | 尚无评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
