<!--
状态：草稿，未发布。
用途：Discussion #14285 的回复正文，供作者过目后决定是否发布。
目标渠道：上游仓库的 Discussions（上游 CONTRIBUTING 声明不接受外部 PR、Issues 已关闭，Discussions 是唯一被认可的反馈渠道）。
说明：本仓库是 fork；本回复以分析为主，未附代码改动，因为两个修复方向都依赖维护者掌握的产品事实与协议设计决策。
-->

# English reply (for posting to Discussion #14285)

I could confirm both halves from the source, and part 1 goes a bit deeper than "the default model is missing from the catalog" — the catalog gap is one link in a chain that ends in a silent capability advertisement.

**Part 1: where `image: false` comes from**

The ACP bridge advertises `promptCapabilities.image` from `supportsAcpImagePrompts`, which asks `llm.resolveModelInfo(provider, model)` for the bridge-level configured provider/model. For the shipped ACP profile that is `deepseek-official` / `deepseek-v4-flash` (`packages/bundle/acp-app/cordis.patch.yml`). The resolution chain for that id on `master`:

1. The advisory official catalog (`DEFAULT_MODELS` in `packages/llm/llm-deepseek/src/models.ts`) contains exactly `deepseek-flash` (declared `inputModalities: ['text', 'image']`) and `deepseek-v4-pro`. `deepseek-v4-flash` has no entry.
2. On the official origin with the built-in catalog, the route follows the official `/models` listing, and a listed model's facts — including `inputModalities` — come from the listing itself. So the capability of `deepseek-v4-flash` is decided entirely by whether the live listing offers it and with what facts. The repo's own fixture listing (`tests/listing.spec.ts`) offers `deepseek-flash` and `deepseek-v4-pro` only; anything the listing does not offer falls back to the advisory catalog, which also lacks the id.
3. `modelInfo()` then resolves an uncatalogued id as text-only by design — the inline comment is explicit that declaring an unverified image capability would let the host persist input the endpoint may reject on every later turn. No error is thrown, so nothing surfaces the degradation.

So `image: false` is the system working as specified — but the default model id it degrades on is not an edge case: `deepseek-v4-flash` is the canonical default across at least six production surfaces (SDK client `api.ts`, `subagent-dsh-sdk`, `web-search-deepseek`, the ACP profile, the SDK types doc, the test-support remote defaults). Whether that id is image-capable on the real endpoint is product truth I cannot derive from the repository, so I have not "fixed" it unilaterally. The coherent options, in increasing blast radius:

- **Catalog entry**: add `deepseek-v4-flash` to `DEFAULT_MODELS` with its true modalities. One entry repairs the capability advertisement everywhere at once. Requires knowing the endpoint truth.
- **Default rename**: if `deepseek-flash` (V4.1-Flash) is the current Flash endpoint, point the six defaults at it instead — but that changes the billed model for every default consumer, which is a maintainer decision, not a patch.
- **Fail loud on the advertisement**: the degradation itself is silent only at the capability layer. Image sends are already protected (`imageRequestTarget` throws `UNKNOWN_MODEL` for an id with no declared image projection), so the request path is safe; the gap is that `promptCapabilities` advertises a capability judgment with no signal that it came from the uncatalogued fallback. A warning when the configured default model resolves through the fallback would match the "misconfiguration fails loud" principle without changing request behavior.

One more layer worth separating: `imagePromptEnabled` is computed once at initialize, from the bridge-level config, and reused for every prompt. `setSessionConfigOption` can switch a session's model afterwards, so a session moved onto an image-capable model still sees `image: false`, and conversely the advertisement is not per-session truth. Deciding whether image admission should be evaluated per prompt (or per model change) is a design question above the catalog fix; I kept it out of the options above on purpose.

**Part 2: fork and truncate over ACP**

The ACP surface on `master` is `authenticate`, `session/new`, `session/list`, `session/resume`, `session/close`, `session/setConfigOption`, `session/prompt`, and `session/cancel`. There is no fork and no truncate. The host remote API does expose `fork` (event-prefix fork into a new Session, with an optional boundary), so the DSH-side capability exists — the gap is that ACP has no method to carry it, and the ACP protocol itself defines no fork or truncate request, so exposing it is a protocol extension, not a binding exercise. Truncate is smaller than that: I found no user-invoked truncate capability in the session layer at all (compaction runs internally), so that half would need a session-layer capability designed before any transport question.

Both of these look like maintainer-owned design decisions rather than something I can usefully patch unilaterally. If it helps, I can prepare a concrete proposal for either — e.g. a per-prompt capability sketch, or a fork-over-ACP method sketch mapping `session/fork` onto the existing host remote — as a follow-up here.

# 中文对照（仅供作者阅读，不发布）

两部分都能从源码证实，而且第 1 部分比「默认模型缺目录条目」更深一层——目录缺口只是链条的一环，链条末端是一次无声的能力通告。

**第 1 部分：`image: false` 的来源**

ACP bridge 的 `promptCapabilities.image` 来自 `supportsAcpImagePrompts`，它查询 bridge 级配置的 provider/model 的 `llm.resolveModelInfo(provider, model)`。随附 ACP profile 配置的是 `deepseek-official` / `deepseek-v4-flash`（`packages/bundle/acp-app/cordis.patch.yml`）。该 id 在 `master` 上的解析链：

1. 官方 advisory 目录（`packages/llm/llm-deepseek/src/models.ts` 的 `DEFAULT_MODELS`）只有 `deepseek-flash`（声明 `inputModalities: ['text', 'image']`）和 `deepseek-v4-pro`。`deepseek-v4-flash` 没有条目。
2. 在官方 origin 且使用内置目录时，该 route 跟随官方 `/models` listing，且被 listing 收录的模型的事实——包括 `inputModalities`——来自 listing 本身。所以 `deepseek-v4-flash` 是否有图像能力，完全取决于线上 listing 是否收录它以及声明了什么事实。仓库自带的 fixture listing（`tests/listing.spec.ts`）只收录 `deepseek-flash` 和 `deepseek-v4-pro`；listing 未收录的 id 回落到 advisory 目录，而目录里同样没有它。
3. `modelInfo()` 随后按设计把未收录 id 解析为纯文本——行内注释写得很清楚：声明未经核实的图像能力会让宿主持久化端点可能在每一轮都拒绝的输入。不抛错，所以降级无处浮现。

所以 `image: false` 是系统按规范在工作——但降级所在的默认模型 id 并非边角情形：`deepseek-v4-flash` 是至少六个生产面的默认值（SDK client `api.ts`、`subagent-dsh-sdk`、`web-search-deepseek`、ACP profile、SDK types 文档、test-support remote 默认值）。该 id 在真实端点上是否有图像能力，是我无法从仓库推导的产品事实，所以我没有单方面「修复」。自洽的选项，按影响面递增：

- **目录条目**：把 `deepseek-v4-flash` 以真实模态加入 `DEFAULT_MODELS`。一条条目同时修复所有面上的能力通告。需要知道端点事实。
- **默认改名**：如果 `deepseek-flash`（V4.1-Flash）就是现行 Flash 端点，把六处默认指过去——但这会改变所有默认消费者的计费模型，是维护者决策而非补丁。
- **通告处 fail loud**：降级只在能力层是无声的。图像发送已有保护（`imageRequestTarget` 对没有声明图像投影的 id 抛 `UNKNOWN_MODEL`），请求路径是安全的；缺口在于 `promptCapabilities` 通告了一个能力判断，却没有任何信号表明它来自未收录回落。当配置的默认模型经回落解析时给出警告，符合「misconfiguration fails loud」原则，又不改变请求行为。

还有一层值得分开：`imagePromptEnabled` 在 initialize 时计算一次（来自 bridge 级配置），并复用到每个 prompt。`setSessionConfigOption` 之后可以切换会话模型，于是被切到有图像能力模型的会话仍然看到 `image: false`；反过来，这份通告也不是会话级事实。图像准入是否应按 prompt（或按模型切换）评估，是目录修复之上的设计问题；我有意把它排除在上面的选项之外。

**第 2 部分：经 ACP 的 fork 与 truncate**

`master` 上的 ACP 面是 `authenticate`、`session/new`、`session/list`、`session/resume`、`session/close`、`session/setConfigOption`、`session/prompt`、`session/cancel`。没有 fork，也没有 truncate。宿主 remote API 确实暴露了 `fork`（按事件前缀 fork 出新 Session，可选边界），所以 DSH 侧能力存在——缺口是 ACP 没有承载它的方法，而 ACP 协议本身也没有定义 fork 或 truncate 请求，所以暴露它是协议扩展，不是接线练习。truncate 比这更靠前：会话层根本没有用户可调用的 truncate 能力（compaction 内部运行），所以这一半需要先设计会话层能力，才轮得到传输问题。

这两个都更像维护者拥有的设计决策，而非我能单方面有效修补的东西。如果有用，我可以为其中任一项准备具体提案——例如按 prompt 的能力评估草图，或把 `session/fork` 映射到既有宿主 remote 的 fork-over-ACP 方法草图——作为本 Discussion 的后续回复。
