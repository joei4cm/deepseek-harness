# #13775 同文件稀疏多窗口读取 — 调查结论（未发布草稿）

状态：一行接手声明已发布（discussioncomment-19978969）；本实质回复**未发布**，需单独授权。

## 结论

在当前 master（841f76d3c5）上不保留代码改动，也不开 PR。

## 依据

- 仓库内没有会对同一文件发出多个 `read` 窗口的 composite 调用方。`read` 只由模型直接调用；`tool-fs-search` 的 grep 只在提示中建议模型再调用 `read`；PTC 执行器不按文件合并调用。报告中的调用方是外部 `dsh-awesome-optimizer` 试点。
- 按 `packages/AGENTS.md` 的「Require a current owner and need」与「Design Service Definitions for all current Consumers」，没有仓内生产消费者的 multi-range 服务或新工具不应加入。
- 若改为扩展模型可见的 `read` schema（如 `ranges`），属于模型可见接口变更，需要录制快照与真实模型证据；报告者自己的 12 对 live A/B 中端到端 P95 为 25.6 s → 30.0 s，收益不确定，试点仍默认关闭。
- 普通单窗口 `read` 已是一次 stat + 一次扫描（`packages/fs/tool-fs/src/read.ts`、`read-render.ts` 的 `buildWindow`）；多窗口重复扫描只在调用方发出同文件多窗口时出现，单窗口路径没有可删除的重复工作。

## 若维护者接受该方向，需先决定

1. 承载者：扩展 `read` 参数，还是 `dsh-tool-fs` 导出供 composite 工具调用的 host 服务；后者需要至少一个仓内消费者。
2. 策略共享：针对 `read` 的策略（权限、caps、observation）如何同样作用于合并读取，避免新工具名绕过。
3. 语义：range 数量上限、聚合行/字节预算、重叠与越 EOF 的逐 range 状态、扫描中写入返回 `FS_STALE_VERSION` 且不发 observation、取消时不返回部分窗口。
