# 架构设计

> 适用版本：v0.8.6。本文面向接手的开发者/Agent，描述系统分层、核心数据流、API 契约与关键设计决策。

## 1. 总体架构

项目有两种部署形态，共用同一业务核心：

```
┌─────────────────────────── 浏览器（SPA）────────────────────────────┐
│  src/App.tsx + components/* + lib/*                                │
│  显示缓存：localStorage（设置副本）+ sessionStorage（看板快照，无凭据）│
└───────────────▲────────────────────────────────▲────────────────────┘
                │ /functions/v1/app/api/*        │
┌───────────────┴──────────────┐  ┌──────────────┴──────────────────┐
│ Qoder Sites Edge Function    │  │ 自托管 Node 24 容器              │
│ functions/index.ts (Deno)    │  │ server/index.ts                 │
│  requireUser = Qoder 访客身份 │  │  requireUser = 会话 Cookie 校验  │
│  存储 = Qoder Storage        │  │  存储 = JSON 文件 (DATA_DIR)     │
│  鉴权路由 = 平台代理（无）     │  │  /api/auth/* = server/auth.ts   │
└───────────────┬──────────────┘  └──────────────┬──────────────────┘
                │          共用业务核心            │
                └────────► functions/routes.ts ◄──┘
                        application() 工厂
                ├─ 账号存储 (AccountStore 接口)
                ├─ 设置存储 (SettingsStore 接口)
                ├─ 余额缓存 (balance-cache.ts, TTL 30s)
                ├─ 限流器 (rate-limit.ts, 每 user 固定窗口)
                └─ 上游查询 (balances.ts, 并发上限 8)
                             │
                             ▼
              各平台余额接口（DeepSeek/Kimi/硅基流动/
              OpenRouter/MiniMax/基元律动/WorkBuddy/
              Qoder/智谱 AI）
```

**核心设计决策**：`functions/routes.ts` 导出 `application({ createStore, createSettingsStore, requireUser, load?, now?, limits? })`，返回 `(Request) => Promise<Response>` 处理器。所有业务路由、校验、限流、缓存都在这一层，与运行环境无关。新增路由只改 `routes.ts`，两种形态同时生效。

## 2. 模块说明

### 2.1 后端（functions/）

| 文件 | 职责 |
| --- | --- |
| `routes.ts` | **业务核心**。全部 API 路由、鉴权调用、限流、缓存、锁、错误映射 |
| `accounts.ts` | 账号存储接口 `AccountStore`、输入校验（`validateCreate`/`validatePatch`）、`MAX_ACCOUNTS=40`、`MAX_BODY_BYTES=32KB` |
| `settings.ts` | 设置存储接口 `SettingsStore`、`parseSettings` 校验（刷新间隔白名单、阈值 0..1e9、未知平台忽略） |
| `balances.ts` | 各平台余额查询实现 `loadAccount(account)`，含会话 Cookie 规范化（`session.ts`）；智谱按凭据类型返回余额或额度卡（`loaded.kind` 可覆盖平台默认 kind） |
| `balance-cache.ts` | 每用户 TTL 缓存（30s，上限 2000 条，single-flight 合并并发请求，`refresh=1` 绕过，PATCH/DELETE 时失效） |
| `rate-limit.ts` | 通用固定窗口限流器（每 key），带 bucket 数上限防内存膨胀 |
| `session.ts` | Cookie 字符串中会话值的提取与校验（拒绝非会话 Cookie，如只含 `tr_ref_device`） |
| `store-storage.ts` | Qoder Storage 适配的 AccountStore/SettingsStore（按 user_id 隔离路径）；账号文件存储版本 2（`credential.enc`），读取时透明解密并把 version 1 明文条目迁移为密文 |
| `storage-crypto.ts` | WebCrypto 凭据加密：AES-256-GCM，载荷格式与 AAD 同 `server/data-crypto.ts`（密文可跨部署形态互读）；主密钥来自站点 Secret `PANEL_DATA_KEY`，缺失/非法时所有凭据操作失败关闭 |
| `index.ts` | Qoder Deno 入口：装配 Qoder Storage + Qoder 访客身份；从 `PANEL_DATA_KEY` 站点 Secret 构建凭据加密器 |
| `auth.mjs` | Qoder 平台提供的访客身份解析（平台适配层，勿改动） |

### 2.2 自托管宿主（server/）

| 文件 | 职责 |
| --- | --- |
| `index.ts` | Node http 宿主。加载数据密钥、装配文件版存储、接 Auth 路由后再交给 `routes.ts`；`requireUser` 校验会话 Cookie，失败抛 `{code:"login_required", status:401}`；请求体有界缓冲；密钥初始化失败直接 exit 1 |
| `auth.ts` | 自托管鉴权：scrypt 密码哈希（`auth.json`）、HMAC-SHA256 签名会话令牌（secret 落盘 `session-secret`，0600）、`/api/auth/*` 路由（登录限流 10/min/IP）、Cookie 读写 |
| `data-crypto.ts` | 凭据加密：AES-256-GCM（随机 12B IV + 认证标签，AAD `token-panel:credential:v1`）；主密钥来自 `PANEL_DATA_KEY` 或 `data/data-key`（0600，首启生成） |
| `file-store.ts` | 文件版 AccountStore / SettingsStore：原子写（临时文件 + rename）、统一 0600、账号文件存储版本 2（`credential.enc`）、读取时透明解密并把 version 1 明文条目迁移为密文 |

自托管鉴权路由在 `server/index.ts` 中**先于** `handle` 拦截（`/api/auth/*` 不进入 `routes.ts`），因此 Qoder Sites 形态没有这些路由——前端以 `auth/status` 返回 404 视为"平台托管登录，始终已登录"。

### 2.3 前端（lib/ + components/）

| 文件 | 职责 |
| --- | --- |
| `request.ts` | 统一 API 客户端。401/403 时优先解析响应体 `error` 码并映射中文文案，否则回退通用"无权限"文案 |
| `balance.ts` / `accounts.ts` / `settings.ts` | 看板/账号/设置的 API 封装与响应校验；`login_required` 映射为登录过期 |
| `auth.ts` | 登录/登出/状态/改密码 API；`isSessionExpired(error)` 供全局会话失效检测 |
| `browser-cache.ts` | sessionStorage 看板快照（`token-panel:dashboard-cache:v1`，24h 上限，**不含凭据**），`clearDashboardCache` 供登出清理 |
| `settings.ts` | localStorage 设置副本（`token-panel:settings-cache:v1`，服务端权威、本机只读加速），`clearCachedSettings` |
| `platforms.ts` | 平台元数据（id、名称、货币、凭据字段、获取指南、主题色） |
| `theme.ts` / `format.ts` / `status.ts` / `utils.ts` | 主题、格式化、余量状态分级（ok/low/empty/error）、className 工具 |

组件：`App.tsx`（登录门控 + 看板 + 全局状态）、`login-view.tsx`、`balance-card.tsx`、`summary-bar.tsx`、`settings-sheet.tsx`（含"安全"分区）、`account-dialog.tsx`、`status-pill.tsx`。UI 原语一律取自 `components/ui/`（Shadcn 目录），不得为同一控件引入第二套组件库。

## 3. API 参考

所有路径省略前缀 `/functions/v1/app`。除注明外均需登录（Qoder 访客身份或 `panel_session` Cookie）。JSON 错误格式统一为 `{"ok":false,"error":"<code>"}`。

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 无 | 健康检查，`{"ok":true}` |
| GET | `/api/auth/status` | 无 | 自托管专用。`{authenticated, username?}`；Qoder 形态 404 |
| POST | `/api/auth/login` | 无 | 自托管专用。`{username, password}` → Set-Cookie `panel_session`（7d）；错误 `invalid_credentials`/`rate_limited` |
| POST | `/api/auth/logout` | 无 | 自托管专用。清除 Cookie |
| POST | `/api/auth/password` | 会话 | 自托管专用。`{currentPassword, newPassword}`；错误 `wrong_password`(403)/`weak_password`(400，长度 8..128) |
| GET | `/api/dashboard?refresh=1` | 会话 | 全部账号余额。`refresh=1` 跳过缓存（手动刷新）；响应含 `fetchedAt` 与 `platforms[]`（含 `cached` 标记） |
| GET | `/api/settings` | 会话 | 读取设置 `{intervalSec, thresholds, order}` |
| PUT | `/api/settings` | 会话 | 写入设置（整体替换），非法内容 `invalid_settings` |
| POST | `/api/accounts` | 会话 | 添加账号 `{platform, label?, credential}`；超 40 个 `too_many_accounts`；返回 201 + 摘要（不含凭据） |
| PATCH | `/api/accounts/:id` | 会话 | 更新 label/credential，账号缓存随之失效 |
| DELETE | `/api/accounts/:id` | 会话 | 删除账号及其服务端凭据 |

**限流**（按用户，读写分开计数）：读取 120/min，写入 30/min；超限 `429 rate_limited` + `Retry-After`。**请求体**：非 JSON 或超 32KB → `400 invalid_input`。

**错误码 → HTTP**：`login_required` 401 · `invalid_user_context` 403 · `invalid_input`/`invalid_settings` 400 · `too_many_accounts` 409 · `not_found` 404 · `method_not_allowed` 405 · `settings_unavailable`/`accounts_unavailable` 503 · `request_failed` 500。

## 4. 关键数据流

### 4.1 看板刷新

1. 前端 `GET /api/dashboard`（自动刷新走缓存，手动刷新加 `refresh=1`）。
2. `routes.ts` 先查用户级限流，再读账号列表，`mapLimit(accounts, 8)` 并发查询；每个账号经 `balance-cache.load(userId, accountId, loader, fresh)`：
   - 缓存命中且未过期（30s）→ 直接返回，`cached: true`（卡片显示"· 服务端缓存"）；
   - 未命中/过期/`fresh` → 调用 `loadAccount`，并发请求通过 single-flight 合并为一次上游查询。
3. 前端成功后写入 sessionStorage 快照；失败时若已有快照则继续显示并在横幅提示"当前显示…快照"。

### 4.2 设置同步（服务端权威）

- 页面加载：先渲染 localStorage 副本（秒开），后台 `GET /api/settings` 覆盖并回写副本。
- 用户修改：即时更新 UI（`saving` 态），500ms 防抖后 `PUT /api/settings`；保存队列串行化（`persistSettings` + pending 合并），失败显示"重试"。
- 会话失效（401 `login_required`）：任何请求命中即切回登录页。

### 4.3 自托管登录

1. 首次启动：`data/auth.json` 不存在时从 `PANEL_USERNAME`/`PANEL_PASSWORD` 环境变量种子（无环境变量则生成随机密码并打印到日志一次）；会话密钥写入 `data/session-secret`。
2. 登录：校验 scrypt 哈希 → 签发 `base64url(payload).hmac` 令牌（payload `{u, e}`，7 天）→ Set-Cookie（HttpOnly/Secure/SameSite=Lax；`Secure` 由请求协议或 `X-Forwarded-Proto` 决定）。
3. 鉴权：`requireUser` 每请求验签 + 过期检查；改密码只更新 `auth.json`（旧会话仍有效，登出可强制下线）。

## 5. 存储与安全边界

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 平台凭据 + 账号列表 | 服务端（Qoder Storage 或 `data/accounts.json`） | 两种部署形态均以 AES-256-GCM 密文存储（`credential.enc`，格式互通）；永不出现在 API 响应、浏览器缓存、日志 |
| 设置（间隔/阈值） | 服务端权威 + localStorage 副本 | 副本仅显示加速 |
| 看板快照 | sessionStorage（单标签页） | 仅余额数字，关标签即清；登出主动清除 |
| 面板密码 | `data/auth.json`（scrypt） | 明文不落盘、不进日志 |
| 会话密钥 | `data/session-secret`（0600） | 轮换即全体会话失效 |
| 数据密钥 | `data/data-key`（0600）或 `PANEL_DATA_KEY` | 丢失即无法解密 `accounts.json`；须与密文成对备份 |

权限模型：容器以 `node`（uid 1000）运行，`data/` 归属 1000:1000，所有数据文件 0600；宿主 root 仍可读取内存与密钥文件，加密主要防的是数据文件外泄（误拷、未加密备份、日志/工单附带样本）。

已知取舍（后续扩展方向）：Qoder Sites 托管版的凭据加密依赖站点 Secret `PANEL_DATA_KEY`（需在 Site Settings 配置，未配置时账号读写以 `accounts_unavailable` 失败关闭）；单用户模型（`user_id` 固定 `selfhosted`），多用户需扩展 `requireUser` 与存储隔离。
