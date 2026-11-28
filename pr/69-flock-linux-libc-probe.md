## Motivation

上游 Discussion #6441 报告：Linux 上第一次获取 Session 写锁时，事件循环会被阻塞几十秒——WSL2 上是永久冻结，端口仍在 LISTENING，所有 HTTP 请求超时，进程连 Ctrl+C 都无效。

根因是 `native/system` 的 flock 入口在加载 addon 之前用 `process.report.getReport()` 判断宿主 libc（`native/system/packages/entry/src/flock.ts`），以选择 `bin/glibc/system.node` 还是 `bin/musl/system.node`。而 Node 的诊断报告会遍历进程里的每一个 libuv handle 与每一个 CPU：

- 网络段对每个已连接的 TCP handle 做同步反向 DNS（`getnameinfo`）。报告实测 1/2/4 个非回环 socket 分别约 10/20/40 秒；对端 PTR 查询卡住时主线程永久阻塞。
- CPU 段逐个打开 sysfs 的 `scaling_cur_freq`。192 核机器上这一项约 4.4 秒。
- 遍历 handle 的过程中进程还会偶发 SIGABRT：报告实测 socket 抖动下 8/16 次中止，不调用报告时 0/6 次。

这段工作落在第一次写租约的关键路径上（`SessionWriteLease.acquire` → `tryLockExclusive` → `loadBinding`），而这是该调用点在仓库中唯一的运行时用途；其余调用点是构建脚本与测试夹具。

Refs #6441

## Changes

**Interface changes**:

None。未改配置键、事件名、事件负载字段、协议或持久化格式。

**Behavior changes**:

- 判定宿主 libc 不再构建诊断报告：入口改为读运行进程自己的内存映射（`/proc/self/maps`），从映射里看进程实际映射的 C 库。
- 判定规则随之调整：映射里出现 musl 的 loader 或库时判为 musl，即使同时映射了 glibc 兼容层的 libc——此时 musl 才是进程实际使用的库；只有两种库都没有出现时才按 glibc 判定。在纯 glibc 与纯 musl 宿主上选中的 addon 与改动前一致。
- 映射不可读时（例如宿主没有可读的 `/proc`）才回退到诊断报告，且只在回退期间排除报告的网络段，之后恢复原值。
- 构建脚本、测试夹具与根仓库的本地 bundle registry 改用同一条规则，因此构建出的变体与运行时选择的变体始终一致。

**Module responsibilities and dependencies**:

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `node-addon-system` | 提供预编译的 Landlock 启动器与 POSIX flock 绑定 | 变化：新增 `libc` 模块，Linux libc 家族的判定归它所有；`flock` 入口、构建脚本与测试夹具都用它，不再各自持有一份判定副本 |
| `local-bundle-registry`（根仓库脚本，不是工作区包） | 打包本地 bundle 闭包并按宿主平台过滤依赖 | 变化：宿主 libc 改用该模块判定，不再自建诊断报告 |

依赖边：无。本 PR 未触及任何 `package.json`，工作区包之间的清单依赖没有增减；根脚本通过 `tsconfig.base.json` 的路径别名引用该模块。

调用流程：

```ts
// native/system/packages/entry/src/flock.ts
filename = join(detectLinuxLibc(), 'system.node') // 读 /proc/self/maps，不构建诊断报告
// native/system/scripts/build.ts
const libc = detectLinuxLibc() // 同一条规则选出要编译的变体
```

## Testing

**Test design**:

| 场景 | 改动前 | 改动后 | 覆盖测试 |
|---|---|---|---|
| 第一次获取写锁 | 构建诊断报告，遍历全部 libuv handle 与全部 CPU | 只读 `/proc/self/maps` | `the entry loads its addon without building a diagnostic report`：子进程把 `process.report.getReport` 换成抛异常的桩，加锁仍须成功 |
| glibc 宿主 | 报告含 `glibcVersionRuntime` → glibc | 映射含 `libc.so.6` → glibc | `entry.test.js` 的 `classifyLinuxLibc` 断言 |
| musl 宿主 | 报告无该字段 → musl | 映射含 `ld-musl-*` → musl | 同上 |
| 同时映射两种库的兼容层宿主 | 按 Node 自身的构建判定 | 优先判 musl | 同上 |
| 映射不可读 | 报告判定 | 回退到报告判定，且回退期间排除网络段 | `resolveLinuxLibc` 断言：映射可用时完全不读报告 |

判定开销（测量条件：本机 Linux 宿主，16 核，空闲，没有已连接的非回环 socket，Node 24.22.3，各 5 次取样）：

| 阶段 | 改动前 | 改动后 |
|---|---|---|
| 判定宿主 libc | 首次 19.8 ms（含懒初始化），稳态 2.0–3.1 ms | 0.08–0.19 ms |

本机没有已连接 socket，CPU 数也远低于报告里的 192 核，因此无法复现上游报告的 10–70 秒阻塞；那些数字来自上游报告本身（1/2/4 个 socket 分别约 10/20/40 秒，192 核机器上 CPU 段 4.4 秒）。本 PR 的作用是把那次报告从热路径上整个去掉，而不是给它加保护。

**Test entries**（均本地运行；CI 另跑矩阵）:

- `cd native/system && pnpm build:ts && node --test ./test/flock.test.js` — 24 passed（新增 1 条用例）。
- `cd native/system && node ./test/entry.test.js` — `entry.test: ok`（新增 12 条 libc 判定断言）。
- 负对照：把 `flock.ts` 改回报告判定并重建后重跑 flock 测试 —— **1 failed**：`the entry loads its addon without building a diagnostic report`，子进程 stderr 为 `Error: the flock entry built a diagnostic report`，栈指向 `lib/flock.js` 的 `loadBinding`；恢复后 24 passed。
- `cd native/system && pnpm build:native --host-addon-only` — 通过；在 `packages/entry/lib` 不存在时再次执行同样通过（发布工作流先构建原生二进制、后构建 TypeScript）。
- `cd native/system && pnpm typecheck` — 通过。
- `pnpm run typecheck` — 5 个 gate 全部通过。
- `pnpm run lint` — 通过。
- `pnpm run test:docs` — 21 个 gate 通过。
- `pnpm run doc-sync` — 43 个 gate 通过。
- `pnpm exec vitest run packages/session/session-persistence-jsonl/tests/lease.spec.ts packages/session/session-persistence-sqlite/tests/lease.spec.ts scripts/local-bundle-registry.spec.ts --maxWorkers=2` — 48 passed。

<details><summary>Proof</summary>

```
$ cd native/system && node --test ./test/flock.test.js
✔ the entry loads its addon without building a diagnostic report (60.28446ms)
ℹ tests 24
ℹ pass 24
ℹ fail 0

$ cd native/system && node ./test/entry.test.js
entry.test: ok
```

负对照（`flock.ts` 还原为报告判定后重跑）：

```
✖ the entry loads its addon without building a diagnostic report (78.158535ms)
  Error: flock fixture exited before replying: {"code":1,"signal":null,"stderr":"...
    Error: the flock entry built a diagnostic report
        at loadBinding (.../packages/entry/lib/flock.js:18:39)
        at errno (.../packages/entry/lib/flock.js:40:9)
        at tryLockExclusive (.../packages/entry/lib/flock.js:39:25)"}
ℹ tests 24
ℹ pass 23
ℹ fail 1
```

</details>

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 95% | Agent 对照 Discussion #6441 的三处证据（反向 DNS、CPU 段、SIGABRT）定位到 `flock.ts` 唯一的运行时 `getReport()` 调用点；作者仅设定目标与纪律 |
| design 方案设计 | auto 模型自主 | 95% | Agent 选择读 `/proc/self/maps` 作为权威信号、诊断报告仅作回退，并把判定规则收敛到入口包内供构建与测试共用 |
| testing 验收测试 | auto 模型自主 | 95% | Agent 设计判定规则的分类用例与一个把 `getReport` 换成抛异常桩的子进程负对照 |
| implementation 技术实现 | auto 模型自主 | 95% | Agent 写全部源码、测试与双语文档改动 |
| review 评审处理 | n/a 暂不适用 | — | 尚未处理任何评审意见 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
