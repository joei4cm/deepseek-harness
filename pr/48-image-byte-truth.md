## Motivation

附加图片时，宿主存储把「声明的媒体类型」与「探测到的字节格式」逐字比对，二者不一致即以 `IMAGE_TYPE_MISMATCH` 拒绝；而客户端把该错误码渲染为「仅支持 PNG、JPG、WebP、GIF 格式的图片」，于是一个格式完全受支持、只是文件名与内容不一致的普通文件（QQ/微信缓存里名为 `.jpeg`、内容为 WebP 的图片）被说成格式不受支持，用户既无从下手，也因此不再上报缺陷（Discussion #14415）。

## Changes

**Interface changes**: None。

**Behavior changes**:

- 附件存储不再比对声明的媒体类型与解码出的格式：图片格式取自解码后的字节，落盘的引用继续报告字节推导出的格式。声明的媒体类型退化为提示，不再是拒绝理由。文件名与内容不一致的 WebP/JPEG/PNG/GIF 图片现在可以附加。
- 部署接受的媒体类型集合改为针对解码出的格式校验：解码格式不在集合内时以 `UNSUPPORTED_IMAGE_TYPE` 拒绝，消息写明解码出的格式；此前存储层不做这项校验，它只发生在针对声明类型的那一层。
- `read_image` 读取扩展名与内容不一致的文件时不再报 `IMAGE_TYPE_MISMATCH`，而是按字节解码出的格式返回图片。
- 错误码词汇表不变：`IMAGE_TYPE_MISMATCH` 仍在 `AttachmentError` 的错误码集合内（实现该接缝的其他存储仍可抛出），出货存储不再抛出它，客户端的既有文案与错误码映射未改。
- 双语文档同步更新：`dsh-attachment` 与 `dsh-attachment-local` 的「可能出什么问题」段落、`dsh-tool-fs` 的 `read_image` 工具行、策略与沙箱段、失败段，以及 `dsh-tool-fs` 已知限制中那条「扩展名声明的媒体类型」条目（改为说明扩展名声明仍先进入部署策略这一剩余约束）。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**:

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| 声明 `image/jpeg`、字节为 PNG 的图片落盘 | 报 `IMAGE_TYPE_MISMATCH` 拒绝 | 以 `image/png` 落盘，引用报告字节推导出的格式 | `attachment-local/tests/store.spec.ts` 新增用例 |
| 解码出的格式不在部署接受的集合内 | 存储层不校验该项 | 报 `UNSUPPORTED_IMAGE_TYPE`，消息写明解码出的格式 | 同一用例的第二段（`mediaTypes: ['image/jpeg']`） |
| `read_image` 读取 `.jpg` 名的 PNG 文件 | 报 `IMAGE_TYPE_MISMATCH`，提示改名或转换 | 读取成功，按 `image/png` 返回图片 | `tool-fs/tests/read-image.spec.ts` 改写用例 |
| 字节不可解码、超出字节/像素/单边限制 | 不变 | 不变 | 既有用例 |
| 声明与字节一致 | 不变 | 不变 | 既有用例 |

负控：把 `packages/attachment/attachment-local/src/store.ts` 还原为 `origin/master` 后，新增的存储用例失败（落盘被 `IMAGE_TYPE_MISMATCH` 拒绝），改写后的 `read_image` 用例失败（读取报错而非成功）；打补丁后全部通过。

**Test entries**:

- 本机 `pnpm exec vitest run packages/attachment/ packages/fs/tool-fs/tests/ --maxWorkers=2`：26 文件 / 502 用例通过（1 条既有跳过）。
- 本机 `pnpm exec vitest run packages/attachment/attachment-local/tests/ --maxWorkers=2 --coverage --coverage.include='packages/attachment/attachment-local/src/store.ts'`：该文件语句 / 分支 / 函数 / 行覆盖率 100%。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run typecheck`：5 项门禁通过。
- 本机 `pnpm run build`：10 项门禁通过。
- 本机 `pnpm run test:docs`：21 项通过。
- 本机 `pnpm run doc-sync`：41 项通过，`tool catalog` 与 `package paths` 两项失败为上游 master 既有问题（`scripts/gen-tool-catalog.ts` 与 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/` 与 master 字节一致，本 PR 未触及）。
- 本机 `pnpm run verify-translation-pairing --write packages/fs/tool-fs/README.md packages/attachment/attachment/README.md packages/attachment/attachment-local/README.md`：三个配对已重新记录。
- 未验证：真实浏览器拖拽路径（QQ/微信缓存文件）与真实模型轮次未在本机重建；修复点在宿主存储层，客户端与协议适配器未改。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复现报告者描述的拒绝路径，核对客户端错误码文案与宿主存储、协议准入、`read_image` 三处判定，确认问题在存储层的声明比对。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「格式取自解码后的字节，部署接受的媒体类型集合改为针对解码格式校验」，保留声明类型作为提示与既有错误码词汇。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 补存储层字节优先用例与部署集合拒绝用例、改写 `read_image` 用例，并跑负控、覆盖率与文档门禁。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写补丁、双语 README 与配对记录。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
