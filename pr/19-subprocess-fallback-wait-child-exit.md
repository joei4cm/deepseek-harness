## Motivation

Discussion #14259 报告：`dsh` 的普通 `bash` 命令存活期间，进程级 CPU 长时间接近满载，HTTP 请求被排队到数百毫秒。CPU profile 指向 `packages/subprocess/subprocess-local/src/spawn.ts` 里 fallback owner 的 `waitForExit` 轮询循环：

- 每次 `alive()` 调用付出 `process.kill(-pgid, 0)` 组探测；leader 结算后再加一次 `/proc/<pid>/stat` 同步读；
- 循环以 15 ms 固定节奏运行，无论 direct child 是否还活着；
- 4 个 waitForExit ≈ 每秒 267 次组探测，加上 `/proc` 读，把一个 CPU 核钉在 ~98%。

报告者同时指出 `master`（0.2.3-alpha.2）已把全表扫描改成 `linuxProcessGroupLiveMember(pgid, knownMember)` 的 `knownMember` 快路径——重要的一半已经修好。剩下的一半是：**轮询本身在 leader 存活期间付出探测代价，而这段期间的探测既不能证明范围为空（leader 还是成员），也不能让 wait 返回**。

## Changes

`fallbackOwner`（spawn.ts，普通命令的 detached 进程组 fallback owner）的 `waitForExit` 改成「事件优先」：

- direct child 结算前：**不再做同步 `alive()` 探测**。等待挂到 `direct` promise（即 ChildProcess 的 `exit` 事件）上唤醒，或 15 ms 计时到期后再次检查 `directSettled`。
- direct child 结算后：开始 15 ms 的 `alive()` 检查循环——此时探测才有可能证明组为空（zombie / 无成员 / `/proc` 不可读都返回 empty），也才有可能让 wait resolve。
- 无存活者的等待（最常见路径）随 `exit` 事件结束，组探测 0 次；有存活者的等待付出与改动前相同的 per-tick 检查。
- 既有不变量保留：`kill(-pgid, 0)` 抛 `ESRCH`/`EPERM` 的语义、`linuxProcessGroupLiveMember` 的 `knownMember` 快路径、`stopped` 作为 no-more-signals 边界、`terminateForHostExit` 与 `terminate()` 的即时路径——都不动。

**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-subprocess-local` | 宿主端 subprocess provider（普通/终端范围、stdio、spill、fallback 组观察） | 变更：fallback owner 的 `waitForExit` 先等 direct child 的 exit 事件再轮询；`sleepTick`/`sleepMs` 不再被该路径使用，移除 |
| `dsh-subprocess` | 服务定义 | 无改动 |
| `dsh-bash-local` / `dsh-pwsh-local` 等消费者 | 通过 seam 调用 `waitForExit` | 无改动；等待语义不变，探测成本下降 |

依赖边：无新增或删除。

## Testing

**Test design**

| 场景 | 期望 | 覆盖测试 |
|---|---|---|
| direct child 存活期间调用 `waitForExit` | 零次 `kill(-pgid, 0)` 探测 | `wakes on the direct child exit event instead of polling while the leader lives`（新增；spy 在 `process.kill` 上断言 group probe 为 0，leader 存活 100 ms 期间） |
| direct child 结算后 `waitForExit` resolve | 一次唤醒后 ≤3 次探测即结束 | 同上新增测试（`terminate()` + `done` 后断言 group probe 增量 ≤3） |
| 整个 detached 树的 wait | 行为不变 | `waits for the whole detached tree, not just the shell`（既有） |
| 组只剩 zombie 成员 | 立即返回 empty | `does not wait for a Linux group that has only zombie members`（既有） |
| 组探测返回 EPERM | 视为仍存活；teardown 时同步探测命名组 | `treats an EPERM group probe as still alive`（更新：事件驱动下首个廉价检查不需要更早探测，`terminate()` 强制同步探测命名组后再 teardown） |
| `waitForExit(signal)` 中止 | 报告 `false`，组仍存活 | `an aborted wait reports false while the tree lives`（既有） |
| survivor 存活时 bounded wait | `false`；escalate 后 `true` | `a bounded waitForExit reports false while a survivor lives, true after escalation`（既有） |
| 服务 teardown 等待树存活者 | 不变 | `service teardown awaits tree survivors, not just handle settlement`（既有） |

**Test entries**

| 文件 | 变化 |
|---|---|
| `packages/subprocess/subprocess-local/tests/spawn.spec.ts` | 新增 1 例（事件唤醒/零探测 + 结算后 ≤3 探测），更新 1 例（EPERM teardown 探测） |
| 既有套件 | 零删除；无快照或 API 变化 |

命令与结果（本地运行）：

```
npx vitest run --maxWorkers=2 packages/subprocess/subprocess-local/tests/spawn.spec.ts
  Test Files  1 passed (1)
  Tests  97 passed (97)

npx vitest run --maxWorkers=2 packages/subprocess/
  Test Files  1 failed | 24 passed | 1 skipped (26)
  Tests  1 failed | 466 passed | 14 skipped (481)
  — spawn-runner.spec.ts 的 Windows PATH 语义用例（相对 PATH 分隔符场景）
    在干净 origin/master（未含本 PR）上同样失败，属环境既有。

npx tsx scripts/run-oxlint.ts packages/subprocess/subprocess-local
  exit 0

pnpm run typecheck
  5 passed, 0 failed, 0 skipped
```

红绿证据：把 `src/spawn.ts` 回退到改动前后复跑新测试——旧实现中等待 100 ms 期间 `kill(-pgid, 0)` 探测 ~6 次（15 ms 节奏），断言失败；恢复实现后 97 全绿，且新断言确认 leader 存活期间 0 探测、结算后 ≤3 探测结束。

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)
<!-- ai-declaration:end -->

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | copilot 人工把关 | 70% | The Agent scanned the day's Discussions, confirmed #14259's remaining half from source (the polling loop still pays a synchronous group probe every 15 ms while the leader is alive), ran the three-way duplication check (no upstream PRs, no fork branch, no prior work), and chose the event-driven wait over a cached process-table snapshot; the author pre-approved selection by the Agent's recommended order. |
| design 方案设计 | auto 模型自主 | 90% | The Agent kept the wait's semantics by splitting it into two phases — the direct child's own 'exit' event while the leader runs, then the 15 ms liveness schedule once it settles — preserving the ESRCH/EPERM verdicts, the `knownMember` fast path, and the no-more-signals boundary. |
| testing 验收测试 | auto 模型自主 | 90% | The Agent wrote a spy-driven test asserting zero group probes while the leader lives and at most three after settlement, updated the EPERM test so its teardown names the group through `terminate()`'s synchronous probe, verified red with the implementation reverted, and re-ran the package suite; the author has not reviewed the results. |
| implementation 技术实现 | auto 模型自主 | 100% | The Agent rewrote the fallback owner's `waitForExit` around `directSettled` and a `directWatcher` wake, removed the now-unused `sleepTick`/`sleepMs`, and updated the bilingual package README with the re-recorded translation pair. |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
