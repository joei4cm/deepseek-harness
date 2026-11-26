<!--
状态：草稿，未发布。
用途：Discussion #14345 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/plugin-manager-bundle-in-use-diagnostic` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（8bd073392e）；报告的根因判断与当前代码树、rc.5 的差异逐条核对过。
-->

# English reply (for posting to Discussion #14345)

I reproduced your report's shape on current `master` (`8bd073392e`), and the conclusion differs from the root cause in your post in one decisive way: **a profile-level override row does not keep the bundle's component mounted.** The guard compares a live entry's `(id, name)` against the rows the bundle contributed, and a settings row is not a declaration — it changes a row another layer declares. When the bundle is deselected, its layer leaves the composition, the settings row's id no longer resolves to anything, the Loader skips it (`patch: entry … not found`), the component is unloaded, and the removal applies. I wrote that down as a regression test on the branch below: the config editor writes the settings row, the row names the component the bundle contributed, and `removeBundle` still succeeds.

The guard itself is the same on `dsh-v0.2.2-rc.5` and on `master`, and so is the composition code that decides which rows exist (`prepareProfilePatches`, `readProfilePatches`, `composeEntries` are byte-identical between the two), so the difference between your run and mine is what your profile declares, not the guard.

What does keep a bundle's component mounted after the bundle is deselected is a layer that *declares* the same row — another bundle that inserts it, an `insert:` row in `cordis.patch.yml`, the home patch, a `--patch` overlay — or the profile's root config `cordis.yml`. That last one is worth spelling out: the root config is launcher-owned. The CLI and the desktop host rewrite it as an empty entry list at every start (`apps/cli/src/profile-boot.ts`, `PROFILE_ROOT_CONFIG`), precisely because the vendored Loader's tree write-back can bake the composed tree into it. A row left there survives the whole session, keeps the component mounted, and the CLI comment in the same file says the next start resets it. Nothing in the running session can switch such a row off, which is exactly the dead end your report describes — and it is also why removing the settings did not help you: the settings row was never the retainer.

That is what my branch fixes. The refusal now carries a diagnostic:

- it names the entries that still hold the bundle (id and resolved module name), and
- it names what still declares them — the bundle layer, `cordis.patch.yml`, the home patch, a launch overlay, or the profile root config, in which case it says that the next start resets that file.

The set of entries that block a removal is unchanged; only the refusal became explainable, and the Web page now shows the diagnostic next to its localized sentence, so the tool's next step ("disable the entries from other layers that still use this bundle") finally has something to point at. If the diagnostic names the profile root config, restarting the profile clears it and the retry succeeds; if it names another bundle, that bundle has to go first; if it names `cordis.patch.yml`, the row there has to go.

Your CLI workaround works because `dsh plugin add` takes the install path, which does not run this guard.

The branch is `fix/plugin-manager-bundle-in-use-diagnostic`, based on upstream `master`. Package suite, client suite, `test:gui`, build, typecheck, lint and the doc gates pass; a full pull-request description is ready, but `CONTRIBUTING.md` states that external pull requests are not accepted at the moment, so I did not open one upstream.

If the diagnostic names something I did not anticipate for your profile, I would like to see that output — the diagnostic is exactly the piece your report was missing, and it is the fastest way to tell which of these layers your `desktop` profile carries.

# 中文对照（仅供作者阅读，不发布）

我在当前 `master`（`8bd073392e`）上复现了你描述的现象，但结论与帖子里的根因判断有一个决定性的差别：**profile 层的 override 行并不会让组合包的组件继续挂载。** 这道守卫比较的是活动条目的 `(id, name)` 与组合包贡献的行；设置行不是声明，它只是修改别处声明的行。组合包取消选中后，它那一层离开合成，设置行的 id 不再指向任何条目，Loader 跳过它（`patch: entry … not found`），组件随之卸载，卸载随即成功。我把这条写成了分支上的回归测试：配置编辑器写下设置行、该行指向组合包贡献的组件，`removeBundle` 仍然成功。

`dsh-v0.2.2-rc.5` 与 `master` 上的守卫代码完全相同，决定哪些行存在的合成代码（`prepareProfilePatches`、`readProfilePatches`、`composeEntries`）也逐字相同，所以你的运行与我的差别在 profile 声明了什么，而不在守卫。

真正让组合包组件在取消选中后仍然挂载的，是声明同一行的层——另一个插入该行的组合包、`cordis.patch.yml` 里的 `insert:` 行、home patch、`--patch` overlay——或者 profile 的根配置 `cordis.yml`。最后这一项值得展开：根配置由启动器拥有。CLI 与桌面宿主在每次启动时都把它重写为空条目表（`apps/cli/src/profile-boot.ts` 的 `PROFILE_ROOT_CONFIG`），原因正是 vendored Loader 的树回写可能把合成后的树烤进这个文件。留在那里的行会活过整个会话、让组件继续挂载，而同一文件里的注释说明下次启动会重置它。运行中的会话没有任何办法把这样一行关掉——这正是你报告里描述的死路，也是删掉设置没用的原因：设置行从来不是占用者。

这正是我的分支修的东西。拒绝现在带上一条诊断：

- 点名仍占着组合包的条目（id 与解析后的模块名）；
- 点名仍声明它的是什么——某个组合包层、`cordis.patch.yml`、home patch、启动 overlay，或 profile 根配置；若是根配置，诊断会说明下次启动即重置该文件。

阻止卸载的条目集合没有变化，变的只是拒绝终于能被解释；Web 页面现在把诊断显示在本地化句子之后，工具给出的下一步（"停用其他层仍在使用这个组合包的条目"）终于有了指向。如果诊断点名 profile 根配置，重启 profile 即可清除并重试成功；如果点名另一个组合包，得先移除那个组合包；如果点名 `cordis.patch.yml`，得先删掉那里的行。

你的 CLI 变通之所以有效，是因为 `dsh plugin add` 走的是安装路径，那条路径不经过这道守卫。

分支是 `fix/plugin-manager-bundle-in-use-diagnostic`，基于上游 `master`。包套件、客户端套件、`test:gui`、build、typecheck、lint 与文档门禁均通过；完整 PR 描述已备好，但 `CONTRIBUTING.md` 声明当前不接受外部 PR，因此我没有向上游开 PR。

如果诊断给出的名字超出我的预期，我很想看到那份输出——诊断正是你的报告里缺的那一块，也是最快判断你的 `desktop` profile 究竟带着哪几层的方式。
