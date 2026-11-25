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
| `11-workspace-menu-fork-failure-notice.md` | `fix/workspace-menu-fork-failure-notice` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14262` |
| `12-client-modules-unadopted-client-half-warning.md` | `fix/client-modules-unadopted-client-half-warning` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14267` |
| `13-llm-pi-ai-discovery-headers.md` | `feat/llm-pi-ai-discovery-headers` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14265` |
| `14-web-app-clean-startup-url.md` | `fix/web-app-clean-startup-url` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14253` |
| `15-team-task-list-empty-owner-filter.md` | `fix/team-task-list-empty-owner-filter` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14280` |
| `16-session-follow-observation-retention.md` | `fix/session-follow-observation-retention` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14263` |
| `17-bash-output-head-tail-preview.md` | `fix/bash-output-head-tail-preview` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14276` |
| `18-shell-signal-exit-status-posix-code.md` | `fix/shell-signal-exit-status-posix-code` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14277` |
| `19-subprocess-fallback-wait-child-exit.md` | `fix/subprocess-fallback-wait-child-exit` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14259` |
| `20-client-pins-persist-settings.md` | `feat/client-pins-persist-settings` | upstream `master`, dsh-v0.2.3-alpha.2 | `#14245` |

Each file is the complete pull-request body for its branch: `## Motivation`, `## Changes`, `## Testing`, and `## AI Usage`, in that order.

The `discussions/` directory holds reply drafts for upstream Discussions, ready for the author to review before posting.
