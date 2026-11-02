# 多平台 Token 余量面板（Token Balance Panel）

一个自托管优先的开源看板，用于集中展示多个 AI 平台的 Token 消耗与账户余量。单用户部署，凭据只保存在服务端，浏览器不接触任何平台 API Key。

当前版本：**v0.8.5**（版本历史见 [docs/CHANGELOG.md](docs/CHANGELOG.md)）

## 功能概览

- **实时余额看板**：支持 DeepSeek、Kimi（Moonshot）、硅基流动、OpenRouter、MiniMax、基元律动（TokenRhythm，会话 Cookie）、WorkBuddy（登录 Cookie）、Qoder（个人访问令牌）、智谱 AI（BigModel）九个平台的余额/额度实时查询；同一平台可添加多个账号。智谱的 API Key 查询 GLM Coding Plan 额度，控制台登录令牌查询账户余额，两种凭据任选其一。
- **查询渠道标注**：每张卡片标明该平台是用官方 API（API Key）还是控制台接口（登录 Cookie）查询，悬停可看具体接口；凭据说明弹窗同步展示。
- **卡片自定义排序**：按住卡片右上角手柄拖动即可换位，卡片菜单也提供「前移 / 后移」；顺序保存在服务端，刷新与跨设备一致。
- **服务端权威存储**：账号凭据、账号列表、刷新频率、低余量提醒线、卡片排序全部保存在服务端；浏览器只保留只读显示缓存（标签页快照，不含凭据）。
- **服务端缓存与限流**：同一账号查询结果服务端缓存 30 秒；单用户读取 120 次/分钟、写入 30 次/分钟；上游并发上限 8。
- **应用内登录**：用户名密码登录（scrypt 哈希 + HMAC 签名会话 Cookie，7 天有效），支持在"设置 → 安全"中修改密码、退出登录。
- **明暗主题**：全站支持浅色/深色主题切换，登录页与看板风格一致。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统架构、模块说明、API 参考、数据流 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发环境、开发流程规范、编码约定、测试 |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 两种部署形态（Qoder Sites / 自托管）、运维手册、备份与回滚 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 开发日志与版本记录 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发约定、测试要求与提交规范 |
| [SECURITY.md](SECURITY.md) | 漏洞报告方式与部署加固清单 |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | 第三方组件与许可说明 |

## 快速开始（本地开发）

Node 版本要求 `^22.13.0 || >=24.0.0`（见 `package.json`）。

```sh
npm ci          # 安装依赖
npm run dev     # 启动 Vite 开发服务器（127.0.0.1，端口自动选择）
npm test        # 运行全部单元测试（node:test，86 个用例）
npm run build   # 类型检查 + 产出 dist/
```

自托管后端（Node 24 原生运行 TypeScript，无需编译）：

```sh
PANEL_USERNAME=admin PANEL_PASSWORD=at-least-8-chars PORT=8000 DATA_DIR=./.data node server/index.ts
```

访问 `http://127.0.0.1:8000` 前端由 nginx/Vite 代理，API 前缀为 `/functions/v1/app/api/*`；本地前端开发服务器已配置同路径代理。

## 两种运行形态

| 形态 | 前端 | 后端 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| Qoder Sites（可选） | 静态 `dist/` | Deno Edge Function（`functions/index.ts`） | Qoder 访客身份 | 面向快速发布；`functions/_qoder` 由发布流程注入，仓库不包含 |
| 自托管（推荐） | 静态 `dist/` 由宿主机 nginx 托管 | Node 24 容器（`server/index.ts`） | 应用内登录（会话 Cookie） | `deploy/` + 宿主 nginx，HTTPS 由 acme.sh 管理 |

两种形态共用同一套业务核心 `functions/routes.ts`（`application()` 工厂），仅 `requireUser`、存储实现和入口不同——新增业务路由时只需改这一处，两种形态自动生效。

## 目录结构

```
├── src/                  # 前端入口与全局样式
├── components/           # 业务组件 + components/ui（Shadcn 目录）
├── lib/                  # 前端业务逻辑（API 客户端、缓存、主题、平台元数据）
├── functions/            # 后端业务核心（routes.ts）与 Qoder Function 适配
│   ├── _qoder/           #   Qoder Sites 平台 SDK（发布时注入，不入库）
│   └── auth.mjs          #   Qoder 访客身份适配（Deno 环境）
├── server/               # 自托管 Node 宿主（index.ts + auth.ts）
├── dev/                  # 本地函数开发入口（内存/文件存储），不参与部署
├── deploy/               # 自托管部署产物（Dockerfile、compose.yml）
├── tests/                # node:test 单元测试
├── scripts/              # 构建 / Node 版本检查脚本
├── docs/                 # 开发文档（架构、开发、部署、变更日志）
└── dist/                 # 构建产物（部署时上传）
```

## 安全基线

- 平台凭据仅存服务端；API 响应、浏览器缓存、日志均不返回凭据内容。
- 两种部署形态的平台凭据均以 AES-256-GCM 加密存储（自托管：`PANEL_DATA_KEY` 或 `data/data-key`；Qoder Sites：站点 Secret `PANEL_DATA_KEY`，密文格式互通）；自托管容器以非 root（uid 1000）运行，数据文件 0600。
- 登录密码 scrypt 哈希存储（`data/auth.json`）；会话密钥独立落盘（`data/session-secret`，0600）。
- 自托管 HTTP 宿主对请求体有界缓冲（64 KiB 上限），超限直接 413。
- 登录接口限流 10 次/分钟/IP；应用级限流与缓存见 [ARCHITECTURE](docs/ARCHITECTURE.md)。
- 上线前请完整阅读 [DEPLOYMENT 安全清单](docs/DEPLOYMENT.md#4-安全清单) 与 [SECURITY 部署加固清单](SECURITY.md#部署加固清单)。

## 许可证

[MIT](LICENSE)。第三方组件与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 来源说明

本项目基于 Qoder Sites React starter 模板搭建，模板来源与适配说明见 [PROVENANCE.md](PROVENANCE.md)；`vendor/` 内保留原始样式许可。
