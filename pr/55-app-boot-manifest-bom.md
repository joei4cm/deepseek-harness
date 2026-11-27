## Motivation

Profile and dependency manifests can be saved with a UTF-8 byte-order mark by Windows editors. The loader passed the decoded text directly to `JSON.parse`, which rejects U+FEFF, so startup failed before the profile could load (Discussion #14459).

## Changes

**Interface changes**: None.

**Behavior changes**:

- `readProfileManifest` and `readPackageManifest` now accept exactly one leading U+FEFF before JSON parsing.
- A second leading BOM, a BOM outside the first position, or other malformed JSON remains invalid and fails as before.
- The package README documents the accepted BOM behavior in English and Chinese.

**Module responsibilities and dependencies**: None.

## Testing

**Test design** (behavior matrix):

| Scenario | Before | After | Coverage |
|---|---|---|---|
| Profile manifest starts with one UTF-8 BOM | `JSON.parse` throws during startup | Manifest loads normally | New profile round-trip case |
| Manifest starts with two BOMs | Invalid JSON | Still invalid JSON | Same case asserts rejection |
| Manifest has no BOM | Loads normally | Unchanged | Existing profile tests |

**Test entries**:

- Local `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run packages/boot/app-boot/tests --maxWorkers=2`: 22 files, 5,688 tests passed.
- Local coverage for the changed source scope with the same full app-boot test selection and `--coverage --coverage.include='packages/boot/app-boot/src/profile.ts'`: 100% statements, branches, functions, and lines.
- Negative control: restoring `src/profile.ts` from `origin/master` made the new BOM case fail; restoring the fix made it pass.
- Local `pnpm exec tsc -b tsconfig.host.json`: passed.
- Local `pnpm run lint:contracts-ready`: passed.
- Push hook typecheck gates: 5 passed, 0 failed.
- Local `git diff --check origin/master...HEAD`: passed.
- No CI result: upstream does not accept external PRs, so the branch is staged on the fork.

## AI Usage

<!-- ai-declaration:start -->
[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

**AI declaration** ([v0.1.2](https://ai-declaration.md/en/0.1.2)): `auto`
<!-- ai-declaration:end -->

| 阶段 | 级别 | AI 参与度 | 决策记录 |
|:--|:--|--:|:--|
| breakdown 问题拆解 | auto 模型自主 | 100% | Agent traced the reported startup failure to the two manifest readers and selected the narrow JSON parsing fix. |
| design 方案设计 | auto 模型自主 | 100% | Agent chose one shared parser that removes exactly one leading BOM and preserves invalid JSON failures. |
| testing 验收测试 | auto 模型自主 | 100% | Agent added single- and double-BOM cases, ran the app-boot suite, profile coverage, negative control, lint, and typecheck. |
| implementation 技术实现 | auto 模型自主 | 100% | Agent implemented the parser, README updates, and tests. |
| review 评审处理 | n/a 暂不适用 | — | No review comments have been handled. |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
