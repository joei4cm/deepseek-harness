<!--
状态：草稿，未发布。
用途：Discussion #14313 的回复正文，供作者过目后决定是否发布。
说明：按本地 b01aa6d52d 的 README 核对部分现有接口；没有证明完整方案或测试报告者的插件。
-->

# English reply (for posting to Discussion #14313)

The current documentation confirms parts of the building blocks, but I cannot identify a documented single contract that supplies all the guarantees you requested.

- `dsh-llm` documents auxiliary purposes, request-only user inputs, cancellation at preparation, and one-shot prepared calls. Those are useful primitives; their existence alone does not establish per-attempt authorization, durable reconstruction, or deletion semantics for an external plugin.
- The Session README explicitly reserves `appendPluginRecord` for packages under this repository's `packages/experimental/` and says external plugins must not call it. Those records are outside the model-visible surface, but that restriction means they are not currently a supported external-plugin solution.
- A logical event range and a physical read budget are separate guarantees. The reported JSONL decoding cost deserves consideration alongside #14320; I have not verified a supported evidence API that satisfies your complete generation, byte, cancellation, and invalidation requirements.

It would be helpful for maintainers to address these as separate decisions: authorization immediately before each actual attempt, an audit record and retention/deletion policy for auxiliary calls, and physically bounded evidence reads. In particular, the documentation above should not be read as permission to bypass the Session record restriction. I have not tested your extension or verified behavior on your installed release.

# 中文对照（仅供作者阅读，不发布）

当前文档确认了一部分基础能力，但我没有找到一个已文档化的单一接口，能够提供你提出的全部保证。

- `dsh-llm` 文档描述了辅助调用的 purpose、仅用于请求的用户输入、准备阶段的取消以及一次性 prepared call。这些是有用的基础能力，但不能仅凭它们推断外部插件已经获得每次尝试前授权、持久可重建和删除语义。
- Session README 明确将 `appendPluginRecord` 限定在本仓库 `packages/experimental/` 下的包，并要求外部插件不要调用。虽然这些记录不进入模型可见的会话内容，该限制意味着它目前不是受支持的外部插件方案。
- 逻辑事件区间和物理读取预算是不同的保证。JSONL 解码成本可以与 #14320 一并讨论；我尚未验证有现成的证据读取 API 能同时满足你提出的 generation、字节、取消和失效要求。

建议维护者分别回答：每次实际尝试前的授权、辅助调用的审计记录及保留/删除策略，以及物理有界的证据读取。上述文档不能视作绕过 Session 记录限制的许可。我没有测试你的扩展，也没有核实你安装版本的行为。
