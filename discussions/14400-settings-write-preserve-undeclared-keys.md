<!--
状态：草稿，未发布。
用途：Discussion #14400 的回复正文，供作者过目后决定是否发布。
说明：本回复只覆盖「settings save drops unknown keys under a volatile root schema」这半条——`SettingsForms.write` 的 `strip` 在 volatile 路径上直接返回 `{}`，把整个 volatile 对象连同 schema 未声明的键一起删掉。Desktop 恢复按钮那条（`sanitizeProfile` 移走 `cordis.patch.yml`）是独立的产品决定，维持不动。
-->

# English reply

Thanks for the precise report — we confirmed and fixed the secondary issue you flagged: `SettingsForms.write` drops every undeclared key under a volatile object path.

On `fix/settings-preserve-undeclared-keys` we landed two changes, verified end-to-end:

- `strip` is now the exact inverse of `projectForm`: an ordinary object value only loses the volatile fields its schema `dict` declares, and keys the schema does not declare are preserved; a nested volatile object still cleans itself out when it empties; a `!!js` expression at a volatile object path is replaced whole instead of being merged as a `__jsExpr` field.
- Verified with three new real-composition regression tests (volatile root object with undeclared keys, nested volatile object with undeclared keys / `!!js` replacement / empty-container removal, `z.dict` / non-object volatile root `unset`, fieldless `dict: {}` volatile root) plus the existing settings suite — 6 files / 58 tests, 100% statements/branches/functions/lines over `packages/settings/settings/src/**/*.ts`. Without the patch, all three new cases fail with `strip` returning `{}`.

The first half of the issue (the desktop recovery dialog moves `cordis.patch.yml` away and the next `initProfile` recreates an empty `[]`) is a product decision we deliberately did not touch: the button label already describes a reset, and whether to offer an in-app restore is a UX/product call.

# 中文对照

感谢精确的反馈——我们确认并修复了你点出的次要问题：`SettingsForms.write` 会把 volatile 对象路径下所有未声明的键一起删掉。

我们在 `fix/settings-preserve-undeclared-keys` 落了两处改动并端到端验证：

- `strip` 现在是 `projectForm` 的精确互逆：普通对象只删掉 schema `dict` 声明的 volatile 字段，schema 未声明的键原样保留；嵌套 volatile 对象剔空后仍会移除容器；volatile 对象路径上的 `!!js` 表达式在写入新值时被整体替换，而不是按 `__jsExpr` 字段合并。
- 通过三条新增的真实组合回归测试覆盖（volatile 根对象携带未声明键、嵌套 volatile 对象携带未声明键 / `!!js` 替换 / 剔空删容器、`z.dict` / 非对象 volatile 根 `unset`、`dict` 为空的 volatile 根对象），加上现有 settings 全套用例：6 个文件 / 58 条用例，`packages/settings/settings/src/**/*.ts` 语句 / 分支 / 函数 / 行覆盖率 100%。未打补丁时这三条新用例全部失败，`strip` 返回 `{}`。

另一半（desktop 恢复对话框把 `cordis.patch.yml` 移走、下一次 `initProfile` 重建空 `[]`）是产品决定，我们有意不动：按钮文案本身已经描述为重置，是否在应用内提供恢复是 UX / 产品决策。
