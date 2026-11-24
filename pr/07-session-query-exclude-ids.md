## Motivation

搜索消费方经常要排除一部分会话：调用方自己的会话、已归档会话、插件派生的会话。`SessionResultFilter` 目前只有包含型子句（`id`、`cwd`、`created-at`、`parent`、`availability`），消费方只能等提供方排名、分页之后再逐页删除。被删的结果照样占用 `limit` 名额：把翻页交给模型的工具会返回不满甚至为空、但 `has_more: true` 的页；内部翻页的工具则要多调用几次提供方，每次调用都要重新对账（每次都是一次 reconcile，也多一次游标失效的机会——`SESSION_QUERY_STALE_CURSOR`）。

提供一个不透明游标无法表达「页内位置」，所以消费方无法干净地补齐一页。实验性跨会话搜索正是这样：它逐页 `hit => hit.header.id !== caller.id && …`，然后 `collectPages` 一直取页直到凑够 `maxResults`。

范围说明：本 PR 只覆盖「消费方能列出来的排除集合」（调用方自己、已归档的会话、它已知的派生会话）。按 id 前缀隐藏派生会话的部署级规则仍属于工具层（#4913），前缀规则匹配的是尚未被枚举的会话，本子句不替代它。

Refs #14238

## Changes

**Interface changes**

- `SessionResultFilter`（`@deepseek-ai/dsh-session-query` 导出的闭合联合）新增一个分支：`{ kind: 'exclude-ids'; values: readonly SessionId[] }`。

**Behavior changes**

- 语义：该子句拒绝列出的每个 id，与其它子句按 AND 组合。**空列表不排除任何会话**——这与包含型子句「空列表匹配不到任何内容」刻意相反，因此调用方可以无条件带上这个子句。
- 内存提供方（`filterSessions`）：`materializeSessionResultFilters` 与 `id` 一样复制并校验 values；`filterSessionResults` 得到对应谓词。
- SQLite 提供方（`searchSessions`）：`buildSessionWhere` 在列表非空时生成 `session_id NOT IN (?, …)`。排除因此发生在**排名与分页之前**——被排除的会话不占用 `limit` 名额，也不会把某一页挤成短页。
- 游标：`canonicalFilters` 对带 `values` 的子句统一排序，新子句自动进入请求指纹；两次翻页之间被排除的会话集合发生变化时，旧游标失效（与其它过滤器一致，属预期行为）。
- 兼容性：`SessionResultFilter` 是闭合联合，穷举 `kind` 的仓外实现需要多处理一个分支。**不认识该 kind 的旧提供方会明确失败**——`materializeSessionResultFilters` 对未知 kind 抛 `SESSION_QUERY_INVALID_FILTER`，而不是静默返回未排除的结果。无索引、schema 或 Session 数据变更。
- 实验性工具 `dsh-tool-session-query`：`session_search` 现在传 `{ kind: 'exclude-ids', values: [caller.id] }`，并从页后过滤里去掉调用方检查；工作区授权检查（`workspaceAccess.recordAuthorized`）留在原处。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-session-query` | 统一的会话历史查询服务：类型、过滤器物化与谓词 | 变更：`SessionResultFilter` 新增 `exclude-ids`；物化与谓词各加一个分支 |
| `dsh-session-query-sqlite` | 全文搜索后端：参数化谓词、排名、分页 | 变更：`buildSessionWhere` 把 `exclude-ids` 编译成 `session_id NOT IN (…)` |
| `dsh-tool-session-query`（实验性） | 面向模型的跨会话检索工具 | 变更：改用 `exclude-ids` 传调用方 id，页后过滤只留工作区授权 |
| `dsh-tool-cordis` | 生成的 Cordis API 目录 | 变更：随类型变更重新生成（`pnpm run gen-cordis-catalog`） |

依赖边：无新增或删除。

调用流程：

```text
session_search(query)
  → toolInput.buildSessionFilters(args)
  → + { kind: 'cwd', values: [cwd] }
  → + { kind: 'exclude-ids', values: [caller.id] }
  → ctx.sessionQuery.searchSessions({ query, sessionFilters, eventFilters })
  → materializeSessionResultFilters: 复制并校验 values
  → buildSessionWhere: session_id NOT IN (?, …)
  → SQL: matched → filtered (WHERE) → ranked → LIMIT
      排除发生在 ranked 与 LIMIT 之前，被排除的会话不占名额
  → collectPages: 页后只剩工作区授权过滤
```

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| 内存谓词排除列出的 id | 只剩未列出的记录 | `excludes the listed session ids and treats an empty exclusion list as a no-op` |
| 空排除列表 | 不排除任何会话 | 同上 + `compiles the exclusion clause as an empty-list no-op and a NOT IN list` |
| 与其它子句组合 | 仍按 AND 组合 | 同上（`availability` 组合）/ `compiles the exclusion clause…`（`cwd` 组合） |
| 物化阶段的非法值 | `SESSION_QUERY_INVALID_FILTER` | `owns filters and rejects malformed runtime filter shapes deterministically` |
| SQL 编译 | `session_id NOT IN (?, …)`；空列表不产生子句 | `compiles the exclusion clause as an empty-list no-op and a NOT IN list` |
| 排除发生在排名/分页之前 | 被排除的会话不占 `limit` 名额，页仍满 | `drops excluded sessions before ranking so they never consume a page slot` |
| 游标指纹 | 同一集合的顺序无关；集合不同则指纹不同 | `canonicalizes request and filter ordering in both scopes` |
| 工具传递调用方排除 | 每一页请求都带 `exclude-ids`；调用方会话不出现在结果里 | `excludes the caller session on every provider page and keeps it out of the results` |

**Test entries**

| 用例 | 覆盖行为 |
|---|---|
| `excludes the listed session ids and treats an empty exclusion list as a no-op` | 内存谓词：排除、单列组合、空列表无操作 |
| `owns filters and rejects malformed runtime filter shapes deterministically` | 物化复制 `exclude-ids` 的 values；非字符串值被拒 |
| `compiles the exclusion clause as an empty-list no-op and a NOT IN list` | `NOT IN` 编译、空列表不推子句、与 `cwd` 组合 |
| `canonicalizes request and filter ordering in both scopes` | `exclude-ids` 的值排序进入请求指纹；集合变化即指纹变化 |
| `drops excluded sessions before ranking so they never consume a page slot` | 真实 SQLite：排除的会话不占 `limit`，页仍满且有续页游标；空列表不排除 |
| `excludes the caller session on every provider page and keeps it out of the results` | 工具每一页都传 `exclude-ids`；调用方会话不出现在模型可见输出里 |

命令与结果（本地运行）：

```
pnpm exec vitest run packages/session-query packages/experimental/tool-session-query
  Test Files  22 passed (22)
  Tests  423 passed (423)

pnpm exec vitest run packages/api/session-controller packages/context/session-reference packages/session-query
  Test Files  74 passed (74)
  Tests  1528 passed (1528)

pnpm exec vitest run --coverage \
  --coverage.include='packages/session-query/session-query/src/**/*.ts' \
  --coverage.include='packages/session-query/session-query-sqlite/src/**/*.ts' \
  --coverage.include='packages/experimental/tool-session-query/src/**/*.ts' \
  packages/session-query/session-query/tests packages/session-query/session-query-sqlite/tests packages/experimental/tool-session-query/tests
  Statements   : 99.93% ( 1584/1585 )
  Branches     : 100% ( 954/954 )
  Functions    : 99.71% ( 344/345 )
  Lines        : 99.92% ( 1420/1421 )
  ※ 唯一未覆盖的 `session-query/src/cursor.ts` 导出品牌函数在本仓无调用方，
    在未修改的 master 上以同一命令运行同样是这个缺口，与本 PR 无关。

pnpm run typecheck
  5 passed, 0 failed, 0 skipped

pnpm run doc-sync
  43 passed, 0 failed, 0 skipped
  ※ 首轮 5 个失败均已定位并处理，与本 PR 的逻辑无关：
    - documentation build / doc graphs：本机默认堆 OOM，
      `NODE_OPTIONS=--max-old-space-size=10240` 后通过；
    - package README Summaries：工具 README 的 Summary 超过 100 词上限，已在本 PR 内改短；
    - tool catalog / package paths：工作树里残留的已删除包的构建产物目录（仅 lib/ 与
      node_modules/），`pnpm run clean` 后通过。
```

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent reproduced the reported mechanism in the repository (the experimental tool's per-page `hit.header.id !== caller.id` filter, the page-limit accounting in `collectPages`, and the inclusive-only `SessionResultFilter` union) and selected the Discussion from its own candidate list; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent followed the design proposed in the Discussion: one additional clause, an empty list as a no-op, the SQLite provider compiling it before ranking, and the experimental tool passing the caller's id instead of filtering after the page; the author has not reviewed the design. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent added predicate, materialization, SQL-compilation, cursor-fingerprint, provider-level and tool-level tests, including a provider test that shows the excluded session no longer consumes a page slot; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent wrote the type, the in-memory predicate, the SQLite predicate, the tool change, the tests, both README revisions, the subsystem reference update, and recorded the translation pairs; it regenerated the Cordis API catalog. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
