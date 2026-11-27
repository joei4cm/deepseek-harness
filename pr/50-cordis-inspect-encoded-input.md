## Motivation

模型把 `cordis_inspect` 的 `query.input` 作为 JSON 编码字符串发出时，工具参数校验放行（`input` 声明为 `type: 'json'`，任意无损 JSON 值皆可），随后在宿主注册表按方法自身的 object schema 校验时被拒：`Host Cordis inspect Service.listService rejected input: "input" must be an object`（`INSPECT_INVALID_INPUT`）；方法根 schema 为对象时字符串永远无法满足该 schema，模型只能反复重发同一种无效形状（Discussion #14421）。

## Changes

**Interface changes**: None。

**Behavior changes**:

- 宿主检查注册表在唯一校验点做一次有条件解码：当方法的输入 schema 根类型是 `object` 且输入是字符串时，尝试 `JSON.parse`；只有解析结果是非 null、非数组的普通对象且是无损 JSON 值时才采用解码结果，否则原样保留字符串，由既有校验抛出编码与消息均不变的 `INSPECT_INVALID_INPUT`。原始字符串永远无法满足对象 schema，因此解码不会替换任何合法取值。
- 解码后的对象同时用于 Host provider dispatch 与 Client wire request（`CordisInspectQueryRequest.input`）：两条路径共用同一处校验点，`cordis-client-runner` 一侧不做输入校验，解码后的对象随请求下发。
- 非对象根 schema（例如 `{ type: 'string' }`）的方法收到字符串时不解码：字符串对该 schema 合法，方法按原样收到它。
- 错误码词汇表与错误消息不变：`INSPECT_INVALID_INPUT` 仍是「输入违反方法输入 schema」，其诊断文本不变；工具 schema、工具描述与任何模型可见文本均未改动。
- 双语文档同步更新：`dsh-cordis-host-runner` README 的检查失败段补入该解码约定；`docs/subsystems/extensions.md` 及其中文版由 `CordisInspectRegistryService.query` 的 JSDoc 重新生成。

**Module responsibilities and dependencies**: None。

## Testing

**Test design**:

| 场景 | 之前 | 之后 | 覆盖 |
|---|---|---|---|
| Host 方法收到 JSON 编码的对象字符串 | 报 `INSPECT_INVALID_INPUT`：`"input" must be an object` | 解码为对象后调用 provider，provider 收到对象 | `cordis-host-runner/tests/inspect-registry.spec.ts` 新增用例 |
| Client 方法收到 JSON 编码的对象字符串 | 同上，在发往页面的请求前被拒 | 下发的 `CordisInspectQueryRequest.input` 是对象 | 同一用例的第二段 |
| 工具层（模型可见入口）传入编码对象字符串 | 工具拒绝，报 `INSPECT_INVALID_INPUT` | provider 收到对象 | `tool-cordis/tests/tool.spec.ts` 新增用例 |
| 根 schema 不是对象的 method 收到字符串 | 字符串按原样校验 | 不变（字符串对该 schema 合法） | 同一注册表用例的第二段 |
| 字符串不是 JSON、JSON 数组、JSON null、JSON 字符串、JSON 数字 | 报 `INSPECT_INVALID_INPUT` | 不变（错误码与消息逐字相同） | 同一注册表用例的参数化第三段 |
| 字符串是编码对象但解析结果不是无损 JSON（`1e400`、`-0`） | 报 `INSPECT_INVALID_INPUT` | 不变（不以非无损取值进入 provider） | 同一参数化用例的最后两行 |
| 本就是对象的输入 | 按对象校验 | 不变 | 既有用例 |

负控：把 `packages/extensions/cordis-host-runner/src/inspect-registry.ts` 还原为 `origin/master` 后，两条新行为用例失败（Host 分支与工具层各一条，报同一条 `INSPECT_INVALID_INPUT`）；其余用例仍通过，因为它们断言的是未改动的诊断。恢复补丁后全部通过。

**Test entries**:

- 本机 `pnpm exec vitest run packages/extensions/cordis-host-runner/tests/ packages/extensions/tool-cordis/tests/ --maxWorkers=2`：10 文件 / 160 用例全部通过。
- 负控（同上命令，`src/inspect-registry.ts` 还原为 `origin/master`）：2 用例失败、39 通过；恢复后 41/41 通过（该次仅跑两个相关 spec 文件）。
- 本机 `pnpm run lint`：通过。
- 本机 `pnpm run typecheck`：5 项门禁通过。
- 本机 `pnpm run build`：10 项门禁通过。
- 本机 `pnpm run test:docs`：21 项通过。
- 本机 `pnpm run doc-sync`：41 项通过，`tool catalog` 与 `package paths` 两项失败为上游 master 既有问题（`scripts/gen-tool-catalog.ts` 与 `docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/` 与 master 字节一致，本 PR 未触及）。
- 本机 `pnpm run verify-translation-pairing --write packages/extensions/cordis-host-runner/README.md`：配对已重新记录（双语行数各 160 行）。
- 未验证：真实模型轮次（工具层用例经真实工具执行路径覆盖同一接缝）。
- 覆盖率：`vitest.config.ts` 把 `packages/extensions/{cordis-client-runner,cordis-host-runner,tool-cordis,ui-cordis}/src/**` 排除在逐文件 100% 门禁之外，因此改动文件没有本地覆盖率数字；新增函数的每个分支各有独立用例（非字符串输入、非对象根 schema、解析失败、解析结果非对象、解析结果非无损 JSON、解码成功）。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent 复核上游 Discussion #14421 的定位，确认工具参数 schema 为 `type: 'json'`、注册表按方法 object schema 校验是唯一校验点，并核对 `snapshots/` 中每条已录制的 `cordis_inspect` 调用都以对象传入 `input`。 |
| design 方案设计 | auto 模型自主 | 100% | Agent 选定「在唯一校验点按方法根 schema 有条件解码」，保持错误码与消息不变，且解码结果须是无损 JSON 值。 |
| testing 验收测试 | auto 模型自主 | 100% | Agent 补注册表与工具层用例，覆盖 Host、Client、非法字符串与非无损取值，并跑负控与全部门禁。 |
| implementation 技术实现 | auto 模型自主 | 100% | Agent 写补丁、双语 README 更新与 JSDoc 重新生成。 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
