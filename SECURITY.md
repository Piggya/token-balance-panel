# 安全策略

## 报告漏洞

请通过仓库的 **Security → Report a vulnerability**（GitHub 私密漏洞报告）提交，不要开公开 issue。收到后会尽快确认影响范围并给出修复计划；修复发布前请勿公开细节。

## 支持版本

只对最新发布的小版本提供安全修复（当前 `v0.8.x`）。升级前请先备份 `data/` 目录与 `PANEL_DATA_KEY`。

## 部署加固清单

- 全站 HTTPS，HSTS、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` 由反向代理注入。
- API 只监听 `127.0.0.1`，公网只暴露反向代理的 80/443；不要给容器映射 `0.0.0.0`。
- 面板登录密码至少 8 位，首次部署后立即从种子密码改掉；SSH 仅密钥登录并禁用密码登录。
- `PANEL_DATA_KEY` 与 `accounts.json` 必须成对备份；怀疑泄露时按 [DEPLOYMENT](docs/DEPLOYMENT.md#25-凭据加密与密钥管理) 的步骤轮换密钥并重录凭据。
- 不要把真实 API Key、Cookie、会话令牌写进仓库、日志、截图或 issue；本项目所有测试只用假数据。
- 完整的部署检查项见 [DEPLOYMENT §4 安全清单](docs/DEPLOYMENT.md#4-安全清单)。
