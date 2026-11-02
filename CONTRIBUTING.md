# 贡献指南

## 开发环境

- Node `^22.13.0 || >=24.0.0`（`npm run preinstall` 会校验）
- `npm ci` 安装依赖，`npm run dev` 启动前端开发服务器（默认 `127.0.0.1`）

后端可在本地直接以 Node 24 运行 TypeScript，无需编译：

```sh
PANEL_USERNAME=admin PANEL_PASSWORD=at-least-8-chars PORT=8000 DATA_DIR=./.data node server/index.ts
```

## 提交前检查

- `npm test` 全绿
- `npm run build` 通过（`tsc --noEmit` + Vite 构建）
- 改动 UI 时在浏览器里走一遍主流程，并检查 390px 窄屏无横向溢出
- 触碰业务核心 `functions/routes.ts` 时，确认两种部署形态（自托管 / Qoder Sites）都不受影响

## 新增平台

一个平台改动通常涉及四处，缺一不可：

1. `functions/accounts.ts`：`PlatformId`、`PLATFORM_DEFS`、凭据校验分支
2. `functions/balances.ts`：加载器与 `LOADERS` 注册
3. `lib/platforms.ts`：前端元数据（名称、图标、控制台链接、凭据说明、默认阈值）
4. `tests/`：至少覆盖成功解析与凭据失效两条路径，并同步 README 与 CHANGELOG

## 提交信息

使用 `type: 摘要` 形式，`type` 取 `feat` / `fix` / `docs` / `test` / `refactor` / `chore`。一次提交只做一件事；涉及版本发布时同步更新 `package.json`、`docs/CHANGELOG.md` 与 README 的版本号。

## 凭据与隐私

不要提交任何真实 API Key、Cookie、会话令牌、服务器 IP 或域名。测试一律使用明显的假数据。发现安全问题请按 [SECURITY.md](SECURITY.md) 私密报告。
