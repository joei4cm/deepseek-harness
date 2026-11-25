---
kind: upgrade-guide
description: The printed Web startup URL no longer carries the launch token; the one-time login link moves to its own line.
---

# The Web startup URL no longer carries the launch token

English | [中文](guide.zh.md)

## Change

`dsh web` used to print one line, `dsh web: <url>?token=…`, whose address carried the process launch token. Every process able to read that output — a service log, a redirected file, a captured pane — could redeem the token for an owner browser session and answer the harness's own approval prompts.

The startup line now prints the advertised address without the token. The one-time login link, the only address that carries it, is printed on a separate `dsh web login link:` line, and only when the process output is an interactive terminal or when `--print-login-url` asks for it. The default-browser handoff is unchanged: it still receives the signed address, outside the process output.

`webserver/entry-url` entries gain an optional `openUrl` field for a handoff address that differs from the published one. `@deepseek-ai/dsh-host-authentication-token` contributes the published address and keeps its signed address in `openUrl`. `WebEntryUrl.url` no longer carries provider credentials.

## Migration

1. Replace the scripts that sign a browser in from the printed URL. They now read the login link line, `dsh web login link: <url>`, and pass `--print-login-url` when the output is redirected. The address line stays `dsh web: <url>` and stays credential-free.
2. Operators who copied the printed URL into a browser find that the address alone no longer authenticates. Run the host with an interactive terminal, where the login link is printed, or pass `--print-login-url` and accept that the link lands in the captured output.
3. Custom `webserver/entry-url` listeners that published a credential in `url` move it to `openUrl`. WebApp prints `url` and opens `openUrl ?? url`; the GUI's copy-link entry reads the signed address from `openUrl`.
4. Confirm the migration by starting the Web profile: the address line carries no `?token=`, the login link line appears on an interactive terminal, the opened browser session is authenticated, and the anonymous login page still accepts the pasted link.
