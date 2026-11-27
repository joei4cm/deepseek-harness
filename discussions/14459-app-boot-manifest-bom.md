<!--
Status: draft, not published.
Target: Discussion #14459.
Do not publish without explicit user authorization and a fresh check for new comments.
-->

# English reply (draft)

Confirmed against current `master` (`4b399c39a6`): this is the same UTF-8 BOM failure class as the earlier reports, and the profile manifest path still crashes before the profile loads. The existing recovery advice to remove the leading `EF BB BF` bytes remains valid for an immediate workaround.

We have a narrow fix staged on our fork in `fix/app-boot-manifest-bom` (`f9581e818254a9740a4dff8c2f40f8d80b4efea5`): `readProfileManifest` and `readPackageManifest` now share a parser that removes exactly one leading BOM before `JSON.parse`. A second BOM or a BOM anywhere else remains invalid JSON, and dependency manifests get the same tolerance because profile resolution reads them through the same failure path.

Validation: the full app-boot suite passes (22 files / 5,688 tests), profile source coverage is 100% across statements, branches, functions, and lines, the new single-BOM case fails with master's parser and passes with the fix, host typecheck and lint pass, and the push-hook gates are green. Upstream does not accept external PRs, so the branch is staged on our fork with no CI result. We did not modify your Windows installation or determine which editor wrote the BOM.

# 中文对照（仅供阅读，不发布）

已对照当前 `master`（`4b399c39a6`）确认：这与此前的 BOM 故障属于同类，profile manifest 路径仍会在 profile 加载前崩溃。现有移除开头 `EF BB BF` 三字节的恢复建议，对当前版本仍是有效的临时处理。

我们已在 fork 上暂存窄修复分支 `fix/app-boot-manifest-bom`（`f9581e818254a9740a4dff8c2f40f8d80b4efea5`）：`readProfileManifest` 与 `readPackageManifest` 共用一个解析器，在 `JSON.parse` 前只移除一个开头 BOM。第二个 BOM 或非开头位置的 BOM 仍是非法 JSON；由于 profile 解析会通过同一失败路径读取依赖 manifest，这些 manifest 也获得相同容错。

验证：app-boot 全套通过（22 个文件 / 5,688 个测试），profile 源文件的语句、分支、函数和行覆盖率均为 100%；新的单 BOM 用例在 master 解析器下失败、在修复后通过；host typecheck 与 lint 通过，推送钩子门禁全绿。上游不接受外部 PR，因此分支暂存在 fork，没有 CI 结果。我们没有修改你的 Windows 安装，也无法确定是哪个编辑器写入了 BOM。
