<!--
状态：草稿，未发布。
用途：Discussion #14302 的回复正文，供作者过目后决定是否发布。
说明：核对本地 b01aa6d52d；区分「报告语义已存在」与「真实可见性缺口」；未复现桌面端流程。
-->

# English reply (for posting to Discussion #14302)

The three friction points are real, and the tree confirms two of them as gaps rather than misuse — with one nuance worth recording:

1. **`restart-required` exists but is scoped to Host composition.** The result vocabulary already distinguishes `applied` from `restart-required` (`no-hmr`, `package-moved`, `host-module`, `unmanaged-plugin`, `module-comparison`), and `withNextStep` turns the restart case into an explicit "tell the user to restart" instruction. But that classification tracks whether the *Host* composition changed. A bundle whose new entry is a `dsh.client` contribution activates Host-side and can legitimately report `applied`, while the client module graph (`__DSH_BOOT__`) that the sidebar reads is only re-served per page — and the packaged Desktop document's module set is established at app start. Web has `dsh-client-hmr` pushing live graph snapshots; whether the Desktop document receives an equivalent refresh path is the part your report suggests is missing. So the honest framing is: the signal exists, but "applied" currently overstates visibility for client-side contributions — exactly the misreading you hit. Whether `install_bundle` should report a distinct "client graph requires reload/restart" state is a maintainer product call.
2. **First-run required-Config is a genuine dead end on Desktop.** Two facts combine: `dsh --profile desktop` refuses by design (`args.ts`: "managed exclusively by the Electron application"), and a plugin whose Config validation fails stays inactive — so neither the CLI patch path nor an in-app `configEditor` interaction for an already-mounted plugin is reachable. A first-run configuration prompt or an IPC channel that surfaces `ValidationError` fields into the plugin page is the gap to close; today the half-activated row gives no in-app signal of which field is missing.
3. **Per-row enable/disable exists, with an addressability caveat.** `set_plugin`/`set_bundle` write the desired enablement into the patch layer (`setPluginEnabled` → `writePluginEnabled`), so the mechanism you asked for largely exists — but `listPlugins` marks rows whose parent is not a top-level Include as `unaddressable` (read-only), and agent-preset rows are always read-only. Bundle-contributed rows whose mount point differs from the managed shape would then be toggleable only by editing `cordis.patch.yml`, matching what you observed. Surfacing per-row toggles for every addressable entry of an installed bundle on the plugin page is, again, a product decision — but the tool-side write path is already there.

One caveat on reproduction: I verified these from source, not from a running Desktop install, so the exact `applied` result your install returned may have a narrower cause (e.g. the client-module row not yet known to the already-shipped document). Your ordering experiment — install-then-restart works, install-then-use doesn't — is consistent with either the graph-lifecycle explanation or the document simply never re-fetching the module set.

# 中文对照（仅供作者阅读，不发布）

三个卡点都真实存在，其中两个经源码核实属于缺口而非误用——另有一处值得澄清的语义：

1. **`restart-required` 已存在，但口径只覆盖 Host 组合。** 结果词汇本就区分 `applied` 与 `restart-required`（`no-hmr`/`package-moved`/`host-module`/`unmanaged-plugin`/`module-comparison`），`withNextStep` 会把重启情形翻译成明确的「告知用户重启」。但该分类跟踪的是 *Host* 组合是否生效。新增条目若为 `dsh.client` 贡献，Host 侧激活后可合理报 `applied`，而侧栏读取的客户端模块图（`__DSH_BOOT__`）按页面粒度重服务，打包 Desktop 文档的模块集在应用启动时确定。Web 端有 `dsh-client-hmr` 推送实时图快照；Desktop 文档是否具备同等刷新路径，正是报告提示的缺口。因此诚实的表述是：信号存在，但「applied」对客户端贡献而言夸大了可见性——正是你误读之处。`install_bundle` 是否应报出「客户端图需重载/重启」的独立状态，属维护者的产品决定。
2. **首次运行必填 Config 在 Desktop 上是真实死角。** 两件事叠加：`dsh --profile desktop` 按设计拒绝（args.ts：「managed exclusively by the Electron application」），Config 校验失败的插件保持未激活——因此 CLI patch 路径与对已挂载插件的应用内 `configEditor` 交互都不可达。首次运行配置引导、或把 `ValidationError` 字段透出到插件页的 IPC 通道，才是要补的缺口；当前半激活行在应用内不提示缺哪个字段。
3. **逐行启停已有机制，但有可寻址性限制。** `set_plugin`/`set_bundle` 会把期望启停写进 patch 层（`setPluginEnabled` → `writePluginEnabled`）——你要的机制大体已存在；但 `listPlugins` 会把父级不在顶层 Include 的行标记为 `unaddressable`（只读），agent-preset 行恒只读。bundle 贡献的行若挂载形态与被管理形态不同，就只能手工改 `cordis.patch.yml`，与你观测吻合。插件页为已装 bundle 的每个可寻址行提供开关是产品决定，但工具侧写路径已就绪。

一点复核保留：以上结论来自源码而非运行中的 Desktop 实例，因此你拿到的 `applied` 可能有更具体的成因（如客户端模块行尚未被已装载文档知晓）。你的顺序实验——先装后启可见、装完即用不可见——与「模块图生命周期」和「文档未重取模块集」两种解释都吻合。
