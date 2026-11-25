## Motivation

#14267 报告：作用域命名的第三方插件，同一包的三种安装形态在客户端半侧上表现分裂——npm 别名安装（`<name>@npm:@scope/<name>`）时宿主半侧正常工作，客户端半侧从未被采纳，且「没有任何日志解释」；把所有身份改成一致作用域后（图里已有这条 row、combo 返回 200），客户端 fiber 仍未挂载，宿主日志依旧干净。

在 master 上的排查结论（与讨论区诊断一致）：

1. **别名安装的静默跳过**：Loader row 名 `<name>` 经 Loader 解析到 manifest name 为 `@scope/<name>` 的包；客户端半侧按「精确包名相等」配对，`nearestPackage` 的名称过滤让该 row 与「builtins / 子路径条目不是客户端 row」走同一静默出口（`resolveMeta` 返回 null）——图里没有这条 row，无任何可观察失败。
2. **陈旧 bundle 的浏览器侧拒绝**：一致作用域且 row 已入图时，若 bundle 是改名前构建的——共享构建预设把 manifest name 写进注册 banner（`tsdown.client.ts` 的 `banner`，`id = manifest.name`），浏览器按 banner id 注册 factory，与改名后的 row id 不匹配 → `arrive` 报 "loaded without registering"，可选条目只在浏览器 DevTools console 警告；宿主完全干净。

两个洞都在宿主可判定的位置。修复思路是让它们在组合期（激活与条目重启）发出可操作的警告，而不是改配对规则本身——三处 id 相等是浏览器模块身份的有意设计。

Refs #14267

## Changes

**Interface changes**

- 无公开 API 变化。新增两条宿主诊断警告（`ctx.logger.warn`，激活与条目重启的组合期发出）。

**Behavior changes**

- `locatePkgJson` 名称解析落空时（此前一律静默跳过）：对未按名称过滤的最近 manifest 复查——若它声明 web 客户端半侧，宿主警告 entry 名、manifest 名、manifest 路径与配对规则及修复方向；无客户端半侧或非 web 平台不警告（无损失）。诊断经共享 `parseDshClient` 读取声明：别名安装下的畸形 `dsh.client` 现在与按真名安装一致地响亮失败（此前同样静默）。
- `reconcilePackage` 发布 bundle 时扫描注册 banner（共享构建预设的确定性头部）：banner id ≠ 图 row id → 宿主警告并指向重建；无 banner（第三方打包形态）或 id 相等保持静默。仅在实际发布（非 unchanged 短路）时检查，不重复刷屏。
- README/README.zh：文档化配对规则——manifest name 即浏览器模块 id；包名形式的 Loader entry 必须解析到同名 manifest；bundle banner 由共享预设写入 manifest name——以及两处警告的触发条件。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-client-modules` | 客户端模块系统：宿主组合与浏览器加载 | 变更：组合期两条不可采纳客户端半侧的宿主警告；README 配对规则 |

依赖边：无新增或删除。

调用流程：

```text
组合期（激活 flush / 条目重启）
  resolveMeta → locatePkgJson（名称精确过滤）
    命中 → 照旧（不变）
    落空 → warnSkippedClientHalf
        最近 manifest 无 web 客户端半侧 → 保持静默（无损失）
        声明 web 客户端半侧 → 警告：entry 名 ≠ manifest 名，别名安装永不配对
  reconcilePackage 发布 bundle
    banner 缺失（第三方打包形态）→ 保持静默
    banner id = row id → 保持静默
    banner id ≠ row id → 警告：bundle 陈旧，重建使 banner 携带 manifest name
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 别名安装 + 包声明 web 客户端半侧 | 警告含两个名字与配对规则；图无该 row | `warns when an alias-installed package declares the client half the exact-name pairing drops` |
| 别名安装 + 包无 dsh.client | 静默，图无该 row | `stays silent when an alias-installed package declares no web client half` |
| 名称 row 解析到非 file 模块 | 静默（无 manifest 可查） | `stays silent when a name row resolves to a module no manifest owns` |
| bundle banner 注册别的 id | 警告含两个 id；row 照常发布 | `warns when a served bundle registers under another id` |
| bundle banner 注册 row id | 静默 | `keeps a bundle whose banner registers the graph row id silent` |
| banner 缺失（无 banner 的 bundle） | 静默 | 既有全套件（`writeBuiltPackage` 形态）覆盖 |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `node-half.client.spec.ts` 新增 5 例 | 两条警告的触发/静默矩阵；`constructWithRoute` 新增 `onContext` 钩子使构造前可挂 logger spy |

命令与结果（本地运行）：

```
pnpm exec oxlint packages/client/modules
  0 error

pnpm exec vitest run packages/client/modules
  Test Files  8 passed (8)
  Tests  274 passed (274)

pnpm exec vitest run --coverage \
  --coverage.include='packages/client/modules/src/**/*.ts' \
  packages/client/modules
  Statements   : 100% ( 776/776 )
  Branches     : 100% ( 428/428 )
  Functions    : 100% ( 175/175 )
  Lines        : 100% ( 628/628 )

pnpm run test:gui
  exit 0（全部客户端与宿主 GUI 套件）

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

NODE_OPTIONS=--max-old-space-size=10240 pnpm run doc-sync
  43 passed, 0 failed, 0 skipped
```

补充验证：以本分支的宿主组合启动真实 web 客户端（官方 77 个客户端包全部经 `warnRejectedBundleRegistration` 检查）走 replay e2e——零组合失败、零误报警告，官方 bundle 的 banner id 与 row id 全部一致。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent reproduced both silent drops on master from the Discussion's install matrix (alias install skips the row; stale banner is rejected only in the browser console), verified the pairing rule is intentional design rather than a bug, and confirmed no prior fix exists upstream or in the fork; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent placed both diagnostics at composition time (activation and entry restart), kept the pairing rule untouched, reused the shared `parseDshClient` so a malformed declaration under an alias fails as loudly as under the real name, and scoped the banner check to detected mismatches only so third-party bundle shapes stay silent; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent added the trigger/silent matrix for both warnings (5 new tests), confirmed 100% per-file coverage, and cross-checked the banner check against all 77 official client packages through a real replay e2e boot with zero false positives; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the two diagnostics, the tests, and the English and Chinese README revisions, and re-recorded the translation pairs. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
