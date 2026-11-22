
## Motivation

`dsh-token-meter` 把每个字符都按四分之一 token 计价，因此中文会话的上下文指示器与自动压缩触发器都严重低报：讨论 #14096 里，下一次请求实际携带 1,206,069 token，界面全程显示 24%，压缩也因此从未提前触发，直到请求被服务端以 `CONTEXT_WINDOW_EXCEEDED` 拒绝，而压缩请求本身要携带它正试图缩短的历史，连自救都做不到。

讨论 #13906 给出过独立测量：CJK 文本约 1.64 字符/token，固定值 4 让同一份表面少计约 2.5 倍。

Refs #14096
Refs #13906

## Changes

**Interface changes**

- `@deepseek-ai/dsh-token-meter/estimate` 新增导出 `estimateTextTokens(text: string): number`，供需要按脚本密度单独计价文本的消费者使用。
- `packages/experimental/liveshare` 增加 devDependency `@deepseek-ai/dsh-token-meter`（`workspace:*`）。

**Behavior changes**

- 估算器由「每字符四分之一 token」的固定密度改为按书写语言的密度计价：ASCII 每字符 0.25 token，CJK 表意文字／假名／谚文 0.65，CJK 标点与全角形式 1.0，其他非 ASCII 0.4。
- ASCII 的价格不变，因此既有消费方（spill 预算、压缩阈值、工具结果裁剪上限）的数字不变。
- 系统提示词按上游当前的语义计价：文本块先去除首尾空白，块之间补一个空行分隔（两个 ASCII 字符），再按脚本密度计价；空提示词仍计 0。
- meter、压缩触发器、上下文构成、spill 策略与工具结果裁剪器共用同一个估算器，它们的数字继续一致。
- liveshare 查看器 fixture 改为直接导入共享估算器，删除自行镜像的副本，因此 fixture 的上下文构成不会与 meter 漂移。
- 包 README 与 README.zh.md 记录按语言的 token 密度表、实测依据与残余误差；新增 Agent Note `2026-11-23-script-aware-token-density`。

**Module responsibilities and dependencies**

None。本改动不新增或删除包，也不移动任何包的职责。`packages/experimental/liveshare` 新增的 `@deepseek-ai/dsh-token-meter` 是 devDependency，用于测试 fixture，不构成运行时依赖边。

**Existing test behavior**

- `packages/llm/token-meter` 的既有 137 个测试全部保持通过，新增 11 个用例后共 148 个：ASCII 的价格与此前逐字节相同。
- `packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts` 的「切换到会低估的模型后，压缩应走上一次应答的路由」这一场景需要重新标定 fixture。该场景的前提是：估算值低于 `small` 的 3,200 token 阈值，因此切换检查放行请求，而 `small` 按每字符一个 token 计数并拒绝这个请求。旧 fixture 用 4 轮 × 667 次「上下文」（8,004 个 CJK 字符），在旧的固定密度下约合 2,000 token；在新的脚本密度下同样的历史约合 5,200 token，会在请求发出之前就触发压缩，场景将永远走不到溢出路径。fixture 改为 4 轮 × 360 次「上下文」（4,320 个 CJK 字符）：估算值约 2,900 token，仍在阈值之下，而 `small` 实际计数 4,340 字符，仍超过 4,000 token 的窗口。被测行为——溢出后在上一次应答的路由上做摘要——没有改变，改变的只是让前提继续成立所需的样本大小。

## Testing

**Test design**

行为矩阵（“修改前”指固定密度 0.25，“修改后”指按脚本密度）：

| 场景 | 修改前 | 修改后 | 覆盖测试 |
|---|---|---|---|
| ASCII 文本 | 4 字符/token | 4 字符/token（不变） | `prices ASCII text at four characters per token` |
| 一段中文（提供方计 56 token） | 25 | 65（+16%） | `prices a Chinese paragraph near the DeepSeek-V3 tokenizer` |
| CJK 标点 `。`×10 | 3 | 10 | `prices CJK punctuation at about one token per character` |
| 每个 CJK 区间（11 个区间的首码点） | 3 | 7 | `prices every CJK script as a CJK character` |
| 每个全角区间（5 个区间的首码点） | 3 | 10 | `prices every fullwidth range as a fullwidth character` |
| 其他非 ASCII（西里尔文 50 字） | 13 | 20 | `prices other non-ASCII scripts above ASCII and below CJK` |
| 混合脚本消息 | 按 ASCII 计价 | 按各脚本计价之和 | `prices a mixed message as the sum of its classes` |
| 系统提示词 | 按 ASCII 计价 | 按脚本计价 | `prices the system prompt by the same density` |
| 工具 schema | 按 ASCII 计价 | 按脚本计价 | `prices tool schemas by the same density` |
| ASCII 消息价格 | `ceil(len/4)+8` | `ceil(len/4)+8`（不变） | `leaves an ASCII message at its documented price` |
| 未知块 | 结构化 JSON 价格 | 同左，按脚本密度 | `prices an unknown block as its structural JSON` |

ASCII 一列在修改前后相同，因此这些用例证明该改动没有移动既有消费方的数字；CJK 与全角两列证明脚本分类与区间覆盖是完整的：每个 CJK 区间、每个全角区间都单独取值，且落在 ASCII 与全角之间。

密度不是挑出来的，而是量出来的：以 DeepSeek-V3 的字节级 BPE 分词器与本机由 llama.cpp 分词的 Qwen3.5 模型，对照英文散文、源码、JSON 与本仓库自己的中文文档，两个分词器的结果相差在 5% 以内。在已录制的 harness 会话与仓库内容（29 个样本）上，平均绝对误差相对 DeepSeek-V3 从 18.5% 降到 10.9%，相对 Qwen3.5 从 21.6% 降到 14.1%；最大少计从 46.8% 降到 26.0%。本仓库 690 万字符的中文散文上，估算值与 DeepSeek-V3 的计数相差不到 1%。

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `prices ASCII text at four characters per token` | ASCII 仍为每 token 四字符 |
| `prices a Chinese paragraph near the DeepSeek-V3 tokenizer` | 中文段落与 DeepSeek-V3 分词器的误差在 20% 以内 |
| `prices CJK punctuation at about one token per character` | CJK 标点约每字符一个 token |
| `prices every CJK script as a CJK character` | 11 个 CJK 区间的首码点同价，且介于 ASCII 与全角之间 |
| `prices every fullwidth range as a fullwidth character` | 5 个全角区间的首码点同价 |
| `prices other non-ASCII scripts above ASCII and below CJK` | 其他非 ASCII 的价格介于 ASCII 与 CJK 之间 |
| `prices a mixed message as the sum of its classes` | 混合脚本消息按各脚本求和 |
| `prices the system prompt by the same density` | 系统提示词使用同一密度 |
| `prices tool schemas by the same density` | 工具 schema 使用同一密度 |
| `leaves an ASCII message at its documented price` | ASCII 消息价格与此前一致 |
| `prices an unknown block as its structural JSON` | 未知块按结构化 JSON 计价 |

命令与结果（均为本地运行）：

```
pnpm exec vitest run packages/llm/token-meter
  Test Files  7 passed (7)
  Tests  148 passed (148)

pnpm exec vitest run packages/llm/token-meter packages/compaction/compaction-basic \
                      packages/experimental/liveshare
  Test Files  149 passed (149)
  Tests  1738 passed (1738)

pnpm exec vitest run packages/spill/spill-local
  Test Files  2 failed (2)
  Tests  10 failed | 32 passed (42)
  # 这 10 个失败与本改动无关：在未包含本改动的树上同样失败；该包也不消费 token-meter。

pnpm run typecheck
  run-gates: 5 passed, 0 failed, 0 skipped

pnpm run build
  run-gates: 10 passed, 0 failed, 0 skipped

pnpm run doc-sync
  run-gates: 41 passed, 2 failed, 0 skipped
  # 两个失败与 token-meter 无关，且在本分支的基线 4b399c39a6 上同样失败：
  #   tool catalog   —— scripts/gen-tool-catalog.ts 的 TOOL_PACKAGES 未收录 tool-working-directory
  #   package paths  —— 归档的 v0.2.1-alpha.1 升级指南指向 packages/experimental/ptc-runtime-python，
  #                     该目录在基线上已不存在
```

<details><summary>Proof</summary>

```
$ pnpm exec vitest run packages/llm/token-meter
 Test Files  7 passed (7)
      Tests  148 passed (148)

$ pnpm run build
run-gates: 10 passed, 0 failed, 0 skipped in 43.41s.

$ pnpm run doc-sync
run-gates: 41 passed, 2 failed, 0 skipped in 68.91s.
  - FAILED tool catalog (TOOL_PACKAGES 未收录 tool-working-directory，基线同样失败)
  - FAILED package paths (归档升级指南引用已删除的 ptc-runtime-python，基线同样失败)
```
</details>

**已知的未处理项**

- 上游 #14096 还提到另外四点：指示器以滞后的实测值为基准、压缩失败后没有自救出口、阈值未扣除补全预留、以及核心缺少与插件无关的兜底裁剪。本 PR 只修其中的估算器部分。`dsh-compaction-basic` 的触发预算已经从窗口里扣除了保留的补全 token（`reservedCompletionTokens`），但指示器显示的百分比仍按整个窗口计算，这属于另一个界面行为，本次未改动。其余三点各自独立，未包含在本 PR 中。
- ASCII 的符号密集内容仍少计约 20%（JSON 与工具输出），英文散文仍高估约 22%。把 ASCII 进一步拆成字母／数字／标点／空白已经实测：平均误差只再降 0.4–0.8 个百分点，却会改变每一个 ASCII 数值，从而移动每个会话的 spill 预算、压缩阈值与裁剪上限。这笔取舍记录在 Agent Note 里，留给单独的改动。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent traced the reported symptom chain to the shared estimator and scoped out the plugin-absence fallback and the compaction-failure exit; the author confirmed the token-meter scope from the Agent's list. |
| design 方案设计 | auto 模型自主 | 95% | The Agent chose the per-script density model, the four character classes, and the measured calibration; the author confirmed the recommended option. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent set the acceptance targets — every CJK and fullwidth range, one paragraph checked against the DeepSeek-V3 tokenizer, and the recalibrated compaction fixture — and the case matrix; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the estimator, the test file, both README revisions, the Agent Note triplet, the liveshare fixture change, and the compaction fixture recalibration. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
