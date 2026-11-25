---
kind: upgrade-guide
description: 打印的 Web 启动 URL 不再携带启动 token；一次性登录链接移到单独一行。
---

# 打印的 Web 启动 URL 不再携带启动 token

[English](guide.md) | 中文

## 变更

`dsh web` 过去只打印一行 `dsh web: <url>?token=…`，其地址携带进程启动 token。任何能读到该输出的进程——服务日志、重定向的文件、被捕获的窗格——都能用该 token 兑换 owner 浏览器会话，并代替 harness 自己回答审批提示。

启动行现在打印不含 token 的公告地址。唯一携带 token 的一次性登录链接打印在单独的 `dsh web login link:` 行上，且仅在进程输出是交互式终端、或传入 `--print-login-url` 时打印。默认浏览器交接不变：它仍在进程输出之外收到带签名的地址。

`webserver/entry-url` 的入口新增可选字段 `openUrl`，用于与公布地址不同的交接地址。`@deepseek-ai/dsh-host-authentication-token` 贡献公布的地址，并把带签名的地址放在 `openUrl` 里。`WebEntryUrl.url` 不再携带 Provider 凭据。

## 迁移

1. 替换从打印 URL 登录浏览器的脚本。它们现在读取登录链接行 `dsh web login link: <url>`，并在输出被重定向时传入 `--print-login-url`。地址行仍是 `dsh web: <url>`，且始终不含凭据。
2. 把打印 URL 复制进浏览器的操作者会发现，仅凭该地址不再完成认证。用交互式终端启动宿主，登录链接会打印在那里；或传入 `--print-login-url`，并接受该链接会进入被捕获的输出。
3. 自定义的 `webserver/entry-url` 监听器若在 `url` 中公布过凭据，把它移到 `openUrl`。WebApp 打印 `url`，打开 `openUrl ?? url`；GUI 的复制链接入口从 `openUrl` 读取带签名的地址。
4. 启动 Web profile 即可确认迁移完成：地址行不含 `?token=`，交互式终端下出现登录链接行，打开的浏览器会话已认证，匿名登录页仍接受粘贴的链接。
