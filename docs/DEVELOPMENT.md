# 开发指南

> 面向后续开发者/Agent。包含环境要求、开发流程规范、编码约定、测试与验收要求。

## 1. 环境要求

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | `^22.13.0 \|\| >=24.0.0` | 前端构建、测试、自托管后端（原生运行 TS） |
| npm | 随 Node | 依赖与脚本 |
| Deno（可选） | 任意近期版本 | 仅 Qoder Function 本地开发（`npm run check:function` / `dev:function`） |
| Docker + Compose | 26+ / v2 | 自托管部署 |

**注意**：本机未安装 Deno 时，`npm run build` 与 `npm test` 均可正常运行（它们只覆盖前端与 Node 侧）；Function 的 Deno 类型检查留待有 Deno 的环境执行，交付时如实标注未验证项。

## 2. 常用命令

```sh
npm ci                 # 安装依赖（lockfile 为准）
npm run dev            # Vite 开发服务器（127.0.0.1，自动选端口）
npm test               # 全部单元测试（node:test）
node --test tests/server-auth.test.ts   # 单跑一个测试文件
npm run build          # tsc --noEmit 类型检查 + 产出 dist/
npm run preview        # 本地预览 dist
PANEL_USERNAME=u PANEL_PASSWORD=p PORT=8000 DATA_DIR=./.data node server/index.ts   # 本地起自托管后端
```

本地后端冒烟（常用 curl 序列）：

```sh
curl -s http://127.0.0.1:8000/functions/v1/app/api/auth/status
curl -s -c cj.txt -H 'Content-Type: application/json' \
  -d '{"username":"u","password":"p"}' http://127.0.0.1:8000/functions/v1/app/api/auth/login
curl -s -b cj.txt http://127.0.0.1:8000/functions/v1/app/api/dashboard
```

## 3. 开发流程（商业化规范）

每个版本按以下流程推进，对应记录写入 `docs/CHANGELOG.md`：

1. **需求**：明确功能边界与验收标准（本期做什么、明确不做什么）。
2. **设计**：涉及新路由/新存储/新凭据类型时，先在 [ARCHITECTURE](ARCHITECTURE.md) 对应小节确认现有抽象是否容纳；优先扩展 `application()` 工厂参数而非另起一层。
3. **实现**：业务核心一律改 `functions/routes.ts`（或其依赖模块），保证两种部署形态同时生效；自托管专属逻辑只进 `server/`，Qoder 适配只进 `functions/index.ts`（`functions/_qoder/` 由发布流程注入，仓库不包含）。
4. **测试**：新行为必须带 `tests/*.test.ts` 用例（见 §5）；`npm test` 全绿 + `npm run build` 通过是提交底线。
5. **验证**：UI 变更需在浏览器实际走一遍主流程（登录 → 看板 → 设置）；API 变更用 curl 走通正常 + 主要失败分支。
6. **发布**：按 [DEPLOYMENT](DEPLOYMENT.md) 执行部署并做线上冒烟；发布后在 CHANGELOG 记录版本、日期、变更点与验证情况。

### 版本策略

- 语义化版本 `MAJOR.MINOR.PATCH`，当前 0.x（接口可能变动）。
- MINOR：新功能/新平台接入；PATCH：修复与安全加固；破坏性变更（存储格式、API 契约）必须同步更新迁移/兼容说明。
- `package.json` 的 `version` 与 CHANGELOG 最新条目保持一致。

## 4. 编码约定

- **语言**：TypeScript；前端路径别名 `@/`。后端模块间以 `.ts` 后缀显式导入（Node 原生 type stripping）。
- **注释**：默认不写注释；只为"为什么"（隐藏约束、踩坑记录、非直观行为）写一行注释，不写"是什么"。参考 `routes.ts` 的 `createLockRegistry`。
- **UI 文案**：全部中文，语气克制直接（参考现有 `MESSAGES` 表）；错误文案按 API `error` code 在各 `lib/*.ts` 的 MESSAGES 中集中映射，不散落在组件里。
- **UI 组件**：一律复用 `components/ui/`（Shadcn 目录），按语义选型（表单 Input/Label、弹层 Sheet/Dialog、反馈 Badge/Alert）；不引入第二套组件库，不为改样式重写组件。
- **凭据红线**：任何新代码不得把平台凭据写进日志、API 响应、浏览器存储或测试夹具；测试用假凭据（`test-key-*` 之类）。
- **密码/密钥红线**：密码只存 scrypt 哈希；会话密钥、种子密码不进源码与文档；环境变量是唯一注入通道。
- **边界校验**：只在系统边界（HTTP 请求）校验输入；内部代码信任类型。新请求体超限需复用 `MAX_BODY_BYTES` 与 `readJson` 的有界读取。
- **并发/内存**：新增缓存或 Map 时必须说明容量上限与淘汰策略（参照 `balance-cache` 的 maxEntries 与 `rate-limit` 的 maxKeys）。

## 5. 测试约定

测试框架为 Node 原生 `node:test`（无额外依赖），文件放 `tests/`，命名 `*.test.ts`。

- `routes.test.ts` — API 行为主套件：鉴权 401/403、限流 429、输入校验 400、缓存 TTL/single-flight/refresh/失效、405/404。使用内存 Store + 可注入 `now`，不访问网络。
- `server-auth.test.ts` — 自托管鉴权：哈希往返、会话签发/过期/防篡改、登录限流、改密码全流程、`auth.json` 种子与复用。
- 其余文件按模块对应（`balance-cache`、`rate-limit`、`settings`、`session`）。

新用例要求：

1. 失败分支与成功分支同权重（限流、非法输入、过期会话都要有断言）。
2. 时间相关逻辑一律注入 `now`，不 sleep。
3. 断言从**需求行为**推导，不改断言迁就实现错误。
4. 测试不得依赖外部网络与真实凭据；上游查询用 fake `load`。

## 6. 已知取舍与扩展指引

| 取舍 | 背景 | 扩展时 |
| --- | --- | --- |
| 凭据明文存储 | 用户明确暂不加密 | 加密层应在 Store 实现内做（`AccountStore` 透明加解密），不改 routes 契约 |
| 单用户（`selfhosted`） | 面板为私有部署 | 多用户需扩展 `requireUser` 返回真实 id 并确认存储按 id 隔离 |
| 平台余额接口可能失效 | 平台策略变更 | `loadAccount` 内每个平台独立 try/catch，失败以 `status:"error"` 呈现而非整体 500 |
| Qoder 形态无应用内登录 | 平台自带访客身份 | 前端以 `auth/status` 404 判定，勿假设该路由一定存在 |
