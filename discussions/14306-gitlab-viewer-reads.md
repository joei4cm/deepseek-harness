<!--
状态：草稿，未发布。
用途：Discussion #14306 的回复正文，供作者过目后决定是否发布。
说明：源码侧证实能力缺口与接入面（forge.ts:524-531 的 viewer 声明条件、description 可选方法）；未审查或运行贡献者的 fork 分支。
-->

# English reply (for posting to Discussion #14306)

The tree confirms your reading exactly:

- `ForgeProvider` treats both surfaces as optional: `viewerSources()` only lists a provider when it declares `viewer` *and* implements `listForViewer`/`countForViewer` (`packages/experimental/forge/src/index.ts:524-531`), and `description` is resolved per-provider the same way — a provider that omits it produces the "does not read descriptions" answer rather than an error. `dsh-forge-gitlab` declares neither today; `dsh-forge-github` declares both (`viewer.ts`, `description.ts`). So the change attaches to an existing, explicitly optional capability seam — no registry or UI changes should be needed on the forge side.
- The three API-level gaps you list (no aggregate review decision, no `head_pipeline` on list entities, no `involves:@me` filter on GitLab REST) are all real properties of the GitLab REST surface. The README's `## Known Limitations and Deferred Work` section is where the tree records exactly this kind of provider-level gap; it would be worth carrying those three lines there in the change rather than leaving them only in this thread.
- On `involved`: GitHub-side, `involved` exists precisely because `involves:@me` minus the two named filters gives a well-defined third set. A merged three-list union is a reasonable approximation, but worth naming in the implementation's contract or README as an approximation — consumers reading GitHub and GitLab providers through the same `ForgeViewerSource` shape will otherwise treat them as equivalent.

Two notes on the handover, none of which is mine to decide:

- Since upstream merges are paused, the Discussion + public fork state you already have is the sanctioned form. Attaching the `git format-patch` output to this Discussion would remove the "available on request" round-trip for maintainers.
- `dsh-forge-*` lives under `packages/experimental/` — capability additions there still go through the same gates (typecheck, tests, README pairing), so the untested-gate caveat you gave is the main thing maintainers will want resolved before reviewing the diff itself.

# 中文对照（仅供作者阅读，不发布）

源码侧证实了你的判断：

- `ForgeProvider` 把这两个面都视为可选：`viewerSources()` 只在 provider 声明 `viewer` *且*实现 `listForViewer`/`countForViewer` 时才列入（`packages/experimental/forge/src/index.ts:524-531`），`description` 同理——未实现的 provider 返回的是「不读取描述」而非报错。`dsh-forge-gitlab` 目前两者均未声明，`dsh-forge-github` 两者都有。所以这个改动挂在一条现成的、显式可选的能力缝上，forge 侧应无需改注册表或 UI。
- 你列的三个 API 层缺口（无聚合 review 结论、list 实体不含 `head_pipeline`、GitLab REST 没有 `involves:@me` 过滤器）都是 GitLab REST 面的真实属性。包 README 的 `## Known Limitations and Deferred Work` 节正是用来记录这类 provider 级缺口的地方——建议把这三条写进改动的 README，而不只留在帖子里。
- 关于 `involved`：GitHub 侧它之所以定义良好，是因为 `involves:@me` 减去两个具名过滤恰好给出确定第三集。三路合并去重是合理近似，但值得在实现契约或 README 中点明是近似——同一个 `ForgeViewerSource` 形态下消费 GitHub 与 GitLab provider 的调用方否则会视为等价。

交接方式上两点（是否采纳由维护者决定）：

- 上游合并暂停期间，你现有的 Discussion + 公开 fork 就是既定形式。把 `git format-patch` 输出附在本帖里可以省掉「on request」的一个来回。
- `dsh-forge-*` 位于 `packages/experimental/`——能力增补同样过门禁（typecheck、测试、README 配对），所以你提到的未经本地门禁是维护者审 diff 前最需要补齐的一项。
