## Motivation

Windows 10 上 computer-use 的窗口截图全部失败：helper 要求捕获帧的内容尺寸与捕获表面尺寸严格相等，而 Windows 10 对同一个窗口矩形取整不同，两者常差一像素，于是每一帧都被判为窗口尺寸变化。Refs #14399

## Changes

**Interface changes**: None。

**Behavior changes**:

- 捕获帧的内容尺寸与捕获表面尺寸不再要求相等，允许两像素差异；内容尺寸为空仍然报 `WINDOW_CHANGED`。
- 捕获图像尺寸与窗口边界的比较同样允许两像素差异。窗口在捕获期间发生的真实尺寸或显示缩放变化，仍由捕获前后窗口几何与 DPI 的精确比较报为 `WINDOW_CHANGED`。
- `WINDOW_CHANGED` 消息现在给出捕获尺寸和窗口边界尺寸，被拒绝的捕获可以直接从错误里诊断。
- 更新包 README 英中对，说明捕获尺寸与窗口边界的容差。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**:

| 场景 | 原行为 | 修改后 | 覆盖 |
|---|---|---|---|
| 捕获尺寸与窗口边界相差一像素（Windows 10 取整差异） | 抛 `WINDOW_CHANGED` | 接受捕获 | `A one pixel capture difference is not a resize` |
| 捕获尺寸与窗口边界相差两像素 | 抛 `WINDOW_CHANGED` | 接受捕获 | `A two pixel capture difference is not a resize` |
| 捕获尺寸与窗口边界相差三像素 | 抛 `WINDOW_CHANGED` | 仍抛 `WINDOW_CHANGED` | `A larger capture difference is a resize` |
| 捕获尺寸与窗口边界相同 | 接受捕获 | 接受捕获 | `An identical capture size matches the window bounds` |

负控：把容差常量改成 0（旧的严格相等语义）后运行同一组检查，第一条因一像素差异被拒绝而失败。

**Test entries**:

- 本机 `dotnet build packages/experimental/cua-windows/native/cua-windows.slnx --configuration Release -p:EnableWindowsTargeting=true -p:RestoreLockedMode=true`：通过，0 警告 0 错误（.NET SDK 10.0.404 交叉编译 helper、协议与原生检查工程）。
- 捕获尺寸判定的可执行检查：把 `native/entry/CaptureSize.cs` 编入一个 `net10.0` 临时工程，运行与原生检查相同的四条断言，输出 `4 capture size checks passed`；负控把容差改为 0 后第一条断言失败。
- 本机 `pnpm exec vitest run packages/experimental/cua-windows/tests/ --maxWorkers=2`：6 个文件通过、4 个跳过，86 个测试通过。
- 本机 `pnpm run verify-translation-pairing --write packages/experimental/cua-windows/README.md`：通过。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run doc-sync`：`tool catalog` 与 `package paths` 两项失败，均为上游 master 上既有的问题，与本次改动无关。
- 未在本机验证：截图路径需要 Windows 交互会话。本机是 Linux，helper 可执行文件无法运行，因此 `native/tests` 的可移植检查只做了编译验证，其运行由上游 Windows CI 覆盖；捕获结果本身仍需在 Windows 10 上做一次人工验收。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 依据讨论定位到捕获内容尺寸与捕获表面尺寸的严格比较。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选择以两像素容差取代严格相等，并保留捕获前后几何的精确比较作为真实变化的判据。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 设计容差边界的原生检查并执行负控。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 实现捕获尺寸判定、原生检查与文档变更。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
