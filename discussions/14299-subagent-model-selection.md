<!--
状态：草稿，未发布。
用途：Discussion #14299 的回复正文，供作者过目后决定是否发布。
说明：仅源码分析，无代码改动；是否为服务层补策略检查是产品决策。
-->

# English reply (for posting to Discussion #14299)

Short answer to "who owns the check": the model-selection policy gates **the model's** route choices, not every in-process override — its enforcement point is correctly at the tool layer, because that is where a model-originated request enters. `ctx.subagents.startActivation` is a different trust boundary: plugins are installed code, not an untrusted principal, and the service intentionally treats `agentOptions` as a *provider capability* (`SubagentCapabilities.agentOptions`), validated for support — not for allowlisting.

Your observation is still a real design question, just a narrower one: the setting card (`subagentModelSelection` → the subagent settings UI) reads like "the host decides which routes children may take," and on the direct path the only gates are provider capability and `preflightChildLlmRoute` (route validity — also in the tool path). So the product question is what the setting's contract actually is:

- If the contract is "the host decides which routes **the model** may select," the current split is correct-by-design: the check lives in `requestedAgentOptions`/`assertAllowedModelSelection`, and enforcing it again in `startActivation` would leak tool policy into a service that cannot distinguish "model asked" from "plugin code asked."
- If the contract is "the host decides which routes **any** child may take," then the allowlist belongs in the manager (`resolveChildAgentOptions`/`start`), which is the repo's own "enforce the decision in the operation that makes it" rule — but that is a product decision with a compatibility cost (every existing plugin caller, including presets that legitimately pin a route via `agentOptions`, would newly fail).

Two details worth weighing in that call:

1. The canvas-file concern is real but the threat model is modest: a canvas-state file under the profile directory is already local-user-controlled input; the same actor can change the model in settings. What plugins get on the direct path is *consistency* drift, not an escalation — a config file can silently route a child somewhere the settings UI implied it could not go.
2. A middle option exists if maintainers want the seam explicit: let `startActivation` accept an opt-in `enforceModelSelectionPolicy` (or apply the allowlist when a new spec flag asks for it), so a plugin can *choose* to submit to the host policy — preserving the current default while giving canvas-style plugins a way to honor the setting.

# 中文对照（仅供作者阅读，不发布）

直接回答「检查归谁」：模型选择策略约束的是**模型**的路由选择，而不是所有进程内覆盖——它的执行点在工具层是对的，因为那是模型发起请求的入口。`ctx.subagents.startActivation` 是另一个信任边界：插件是已安装的代码而非不可信主体，服务层有意把 `agentOptions` 当作*提供者能力*（`SubagentCapabilities.agentOptions`）来处理，校验是否支持——而不做白名单。

你的观察仍然是一个真实的设计问题，只是更窄：`subagentModelSelection` 的设置卡片读起来像「宿主决定子智能体可走哪些路由」，而直接调用路径上仅有的闸是提供者能力和 `preflightChildLlmRoute`（路由有效性——同样只在工具路径里）。所以产品问题是这个设置的契约到底是什么：

- 若契约是「宿主决定**模型**可选哪些路由」，当前分工按设计正确：检查住在 `requestedAgentOptions`/`assertAllowedModelSelection`，在 `startActivation` 里再查一次等于把工具策略渗进一个无法区分「模型要的」和「插件代码要的」的服务。
- 若契约是「宿主决定**任何**子智能体可走哪些路由」，白名单就该放进 manager（`resolveChildAgentOptions`/`start`）——这是仓库自己「在做决策的操作里执行决策」的规矩——但这是一个有兼容成本的产品决策（所有现存的插件调用方，包括合法用 `agentOptions` 钉路由的 preset，会新开始失败）。

两个值得在拍板时权衡的细节：

1. canvas 文件的担心是真的，但威胁模型有限：profile 目录下的 canvas-state 文件本来就是本地用户可控的输入，同一行为者也能在设置里改模型。直接路径给插件带来的是*一致性*漂移而非权限提升——配置文件能把子智能体静默路由到设置界面暗示不可达的路由。
2. 如果维护者想把这个缝显式化，有个中间选项：让 `startActivation` 接受可选的 `enforceModelSelectionPolicy`（或 spec 新标志要求时应用白名单），插件可以*选择*服从宿主策略——保留当前默认行为的同时，给 canvas 类插件一个尊重设置的途径。
