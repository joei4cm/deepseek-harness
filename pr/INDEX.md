# Staged pull-request descriptions

This branch holds pull-request descriptions that are ready to open but are not opened, because upstream `CONTRIBUTING.md` states that external pull requests are not accepted and this repository's Issues are disabled. Discussions are the sanctioned feedback channel, so each description references the Discussion that motivates it when one exists.

| File | Branch with the change | Base | References |
|---|---|---|---|
| `01-token-meter-script-aware-density.md` | `fix/token-meter-script-aware-density` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14096`, `#13906` |
| `02-subagent-model-advice.md` | `feat/subagent-model-advice` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14095` |
| `03-llm-local-inference.md` | `feat/llm-local-inference` | upstream `master`, dsh-v0.2.3-alpha.2 | — |
| `04-input-modality-synthetic-key.md` | `fix/input-modality-synthetic-key` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14246` |
| `05-workflow-agent-reasoning-effort.md` | `feat/workflow-agent-reasoning-effort` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14243` |
| `06-subprocess-git-command-line-config.md` | `fix/subprocess-git-command-line-config` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14242` |
| `07-session-query-exclude-ids.md` | `feat/session-query-exclude-ids` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14238` |
| `08-native-command-systemroot-explorer.md` | `fix/native-command-systemroot-explorer` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14258` |
| `09-native-command-powershell-systemroot.md` | `fix/native-command-powershell-systemroot` | `fix/native-command-systemroot-explorer` (stacked; upstream `master`, dsh-v0.2.3-alpha.2) | `#14258` |
| `10-session-fork-workspace-grouping.md` | `fix/session-fork-workspace-grouping` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14262` |

Each file is the complete pull-request body for its branch: `## Motivation`, `## Changes`, `## Testing`, and `## AI Usage`, in that order.
