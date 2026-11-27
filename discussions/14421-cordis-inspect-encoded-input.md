<!--
状态：草稿，未发布。
用途：Discussion #14421 的回复正文，供作者过目后决定是否发布。本稿不复述报告，而是回答作者的两个维护者问题（方向选择、快照判断），报告我们自己的实现与两处与报告者方案的差异，并请维护者在两份实现中取舍。
核对基线：上游 master（4b399c39a6）；我们的分支 fix/cordis-inspect-encoded-input（959e8a028d）。
-->

# English reply (for posting to Discussion #14421)

Your diagnosis matches the code exactly, and we independently confirmed the whole chain: the tool argument is declared `type: 'json'`, so argument validation admits any lossless JSON value including a string; the registry then validates `query.input` against the method's own schema; both the Host and the Client path go through that one validation point, and `cordis-client-runner` does not validate the input at all. The error text you quoted is the `INSPECT_INVALID_INPUT` diagnostic from `packages/core/tools/src/json-schema.ts`.

**On the direction.** We agree the runtime decode is the right shape, and for a reason stronger than the reproduction count: a method whose root input schema is an object never accepts a string, so decoding an encoded object cannot replace a valid value — the tolerance is free of loss by construction. We also read your reasoning evidence the same way you did: a session that wrote "我把它作为 JSON 字符串传了，工具要的是对象" and then sent the same shape again is a session that knew the rule and still could not express the value, which is the case wording cannot reach. We did not take the wording-only option.

**On the snapshot question.** Your judgment is right, and there is a second reason for it: nothing model-visible changes. The tool schema, the tool description, and the error text stay byte-identical; the decode only decides the outcome of a call that previously failed, and the failure it replaces was already an error the model could read. We also walked the recorded corpus: every recorded `cordis_inspect` call under `snapshots/` passes `input` as an object (`{}` for the discovery calls, `{"service":"remote"}` and similar for the exact queries), so no recorded replay changes either. No keyless recorded-session snapshot is needed for this change.

**What we built.** Because upstream `CONTRIBUTING.md` declines external pull requests, our branch lives on our fork — `fix/cordis-inspect-encoded-input` — and this discussion is the report-back channel. It decodes at the same single validation point you identified, with two differences from the patch in your branch:

- The decoded value must also be a lossless JSON value. `JSON.parse` accepts `1e400` as `Infinity` and `-0` as negative zero, neither of which survives a JSON round trip, so those two inputs keep the original string and the usual `INSPECT_INVALID_INPUT` rejection instead of reaching a provider with a value the registry's input contract does not allow.
- The decoder is a module-local function in `src/inspect-registry.ts` rather than a separate module, and the convention is recorded in the package README pair and in the regenerated subsystem reference.

**What we deliberately left alone.** The tool description and the rejection message are unchanged. The model-facing guidance stays "pass the object"; the tolerance is silent, because a description that advertises the encoded form would invite the shape we are tolerating. The error code and message are unchanged as well, so `INSPECT_INVALID_INPUT` keeps its meaning and its text.

**One limit worth naming.** The decode is gated on the method's root schema being `type: 'object'`. A method whose root schema is not an object — a string root, or a `oneOf` at the root — keeps the string as it is, which is correct for a string root and leaves a `oneOf` root without the tolerance. No shipped method has such a root: every first-party inspect method declares an object-rooted input schema, which is also why the failures you collected (`Config.listConfigs`, `Service.listService`, `Slots.listSubTree`, `Tool.listTools`, `Event.listEvents`, `Builtin.listBuiltins`) are all covered.

The direction is yours to pick, and the two implementations differ in small ways rather than in shape. If you prefer your branch, it stands on its own; if you prefer ours, we are happy to adjust it to match the naming and placement you prefer.

# 中文对照（仅供作者阅读，不发布）

你的定位与代码完全一致，我们也独立确认了整条链路：工具参数声明为 `type: 'json'`，因此参数校验放行任意无损 JSON 值（包括字符串）；注册表随后按方法自身的 schema 校验 `query.input`；Host 与 Client 两条路径共用这一个校验点，而 `cordis-client-runner` 一侧完全不做输入校验。你引用的错误文本正是 `packages/core/tools/src/json-schema.ts` 里 `INSPECT_INVALID_INPUT` 的诊断。

**关于方向。** 我们认同运行时解码是正确形态，理由比复现次数更强：根输入 schema 为对象的方法永远不接受字符串，因此解码一个编码对象不可能替换掉任何合法取值——这种容错在构造上就没有损失。我们对你那份 reasoning 证据的读法也与你一致：某个会话已经写下「我把它作为 JSON 字符串传了，工具要的是对象」却仍重发同一种形状，说明它知道规则却无法表达该值，这正是措辞够不到的情形。我们没有采用「只改措辞」的方案。

**关于快照的判断。** 你的判断是对的，而且还有第二个理由：本次改动不改变任何模型可见内容。工具 schema、工具描述与错误文本逐字不变；解码只决定此前失败的调用的结果，而它取代的那个失败本来就是模型能读到的错误。我们也核对了已录制的语料：`snapshots/` 下每一条已录制的 `cordis_inspect` 调用都以对象传入 `input`（发现类调用为 `{}`，精确查询为 `{"service":"remote"}` 一类），因此没有重放结果会变化。本改动不需要 keyless recorded-session snapshot。

**我们的实现。** 上游 `CONTRIBUTING.md` 不接受外部 PR，因此我们的分支发布在 fork：`fix/cordis-inspect-encoded-input`，本讨论即回报渠道。它在你指出的同一校验点解码，与你分支上的补丁有两处差异：

- 解码结果还必须是无损 JSON 值。`JSON.parse` 会把 `1e400` 解析成 `Infinity`、把 `-0` 解析成负零，二者都无法通过 JSON 往返；这两种输入保留原字符串并按既有 `INSPECT_INVALID_INPUT` 拒绝，而不是把注册表输入契约不允许的值交给提供方。
- 解码器是 `src/inspect-registry.ts` 内的模块内函数，而非独立模块；该约定记录在包 README 双语对与重新生成的子系统参考中。

**我们有意没有动的部分。** 工具描述与拒绝消息保持不变。面向模型的指引仍是「传对象」；容错是静默的，因为一旦在描述里宣传编码形态，反而会诱导模型去发我们正在容忍的那种形状。错误码与消息同样不变，`INSPECT_INVALID_INPUT` 保持原义与原文。

**有一处限制值得点明。** 解码以方法根 schema 为 `type: 'object'` 为前提。根 schema 不是对象的方法——字符串根，或根上的 `oneOf`——会原样保留字符串：对字符串根这是正确的，对 `oneOf` 根则意味着没有这份容错。出货的 method 没有这样的根：所有第一方 inspect method 的输入 schema 都是对象根，这也正是你收集到的那些失败（`Config.listConfigs`、`Service.listService`、`Slots.listSubTree`、`Tool.listTools`、`Event.listEvents`、`Builtin.listBuiltins`）全部落在覆盖范围内的原因。

方向由维护者取舍，两份实现的差别只在细节而不在形态。若你更倾向自己的分支，它本身是完整的；若你更倾向我们的，我们愿意按你偏好的命名与落点调整。
