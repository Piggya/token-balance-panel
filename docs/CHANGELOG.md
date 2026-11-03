# 开发日志 / 变更记录

> 遵循 [Keep a Changelog](https://keepachangelog.com/) 风格，版本号语义化（0.x 阶段接口可能变动）。
> 每个版本的发布底线：`npm test` 全绿 + `npm run build` 通过 + 线上（或本地等效环境）主流程验证；验证情况如实记录，未验证项明确标注。

## [Unreleased] / 规划中

- 多用户支持（当前单用户 `selfhosted`）
- 更多平台接入（候选：阿里云百炼、火山方舟，均需云账号 AK/SK）
- Qoder Sites 形态重新发布验证（凭据加密代码已就绪，见 v0.8.2）
- 页脚备案号改为构建变量注入：源码不再包含具体备案号（`VITE_ICP_NUMBER`，见 `.env.example`），未设置时页脚只显示版权；自托管构建通过本地 `.env.local`（已 gitignore）保留备案信息，符合公开仓库与线上合规的双重要求。
- 智谱 AI 的控制台入口改为控制台概览页（`https://open.bigmodel.cn/console/overview`），余额令牌的获取步骤也指向该页面。
- 开源准备：新增 `SECURITY.md`、`CONTRIBUTING.md`、`THIRD_PARTY_NOTICES.md` 与 GitHub Actions CI；`.gitignore` 覆盖运行时 `data/`、`functions/_qoder/`、日志与编辑器目录，避免凭据和平台 SDK 误入库；README/docs 去除内部发布编号。
- 依赖清理：移除未使用的 `zod`、`@hookform/resolvers`、`date-fns` 直接依赖（消除 GHSA-mrhx-c7xc-m3w5 高危告警），`npm audit --omit=dev` 为 0。

## [v0.8.5] — 2026-11-02 · 智谱 AI 接入（额度 / 余额双模式）

**新增**
- 新增智谱 AI（BigModel）平台：一个平台条目支持两种凭据，保存后按凭据类型显示对应卡片。
  - API Key → `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`，展示 GLM Coding Plan 的 5 小时窗口与每周窗口；官方只返回已用百分比，卡片显示剩余百分比与刷新倒计时。
  - 控制台登录令牌（Cookie `bigmodel_token_production`，可粘贴整行 Cookie）→ `GET https://open.bigmodel.cn/api/biz/account/query-customer-account-report`，展示人民币账户余额。
- 两个接口对无效凭据均返回 HTTP 200 + `{code:401,success:false}`，加载器按业务码判定凭据失效并显示 `invalid_key` / `invalid_session`。
- 新增 `tests/zhipu.test.ts`（双模式、CREDIT_LIMIT 回退、unit 缺失按重置时间归类、无效凭据）与智谱凭据校验用例；单测 80 → 86。

**变更**
- `LoadedBalance` 允许加载器覆盖平台默认 `kind`，同一平台条目可按凭据显示余额卡或额度卡；设置默认阈值补充智谱 10 元。
- 添加账号弹窗支持「二选一」凭据：API Key 与登录令牌只能填写一项，同时填写会提示。

**验证**：86/86 单测；`npm run build` 通过；本地浏览器用模拟数据核对智谱额度卡（5 小时 60%、本周 88%、GLM Coding Plan · PRO）、余额卡（¥42.75）、人民币汇总与添加账号弹窗的两种校验；对两个线上接口用无效凭据实测，均返回 `{code:401,success:false}`。自托管已部署 v0.8.5（容器重建，部署前备份 `/opt/token-panel-0.8.4-backup.tar.gz`），首页与哈希资源 200、容器 healthy；容器内用无效凭据调用两个智谱接口，分别归类为 `invalid_key` / `invalid_session`（HTTP 401）。**未验证项**：尚未用真实智谱凭据完成一次成功查询（缺少可用凭据），首次添加真实账号后需复核。

## [v0.8.4] — 2026-10-29 · Qoder 主数字合计资源包

**变更**
- Qoder 额度卡片的主数字改为「套餐剩余 + 资源包剩余」的合计 Credits（套餐 167 + 资源包 200 显示 367）；资源包条形图、重置倒计时与明细项保持不变，没有可用资源包时仍只显示套餐剩余。
- 额度标题改为「总剩余」。说明里的剩余百分比按同一范围计算：`lib/status.ts` 导出 `quotaPercent`，当 `balance` 与套餐窗口剩余不一致时汇总所有窗口，套餐耗尽但资源包仍有余额时不再误判为「已用尽」；MiniMax 等主数字等于主窗口的额度卡维持原判定。
- 卡片算术对齐后再判断低余量/耗尽，用尽提示在合计场景下说「可用额度已用尽」。
- Qoder 帮助文案同步为「套餐余量与资源包余额的合计 Credits」。
- 新增 `tests/status.test.ts` 与套餐耗尽场景的 Qoder 用例；单测 75 → 80。

**验证**：80/80 单测；`npm run build` 通过；本地浏览器用模拟数据核对主数字 367、标题「总剩余」、说明「套餐 + 资源包 Credits · 官方剩余 73%」，并验证套餐耗尽但资源包仍有余额时不判「已用尽」、390px 无横向溢出；自托管已部署（容器重建，部署前备份 `/opt/token-panel-0.8.3-backup.tar.gz`），容器内用已存凭据实测主数字为套餐 167 + 资源包 300 = 467，线上首页与哈希资源均 200。

## [v0.8.3] — 2026-10-29 · 看板视觉重做

**变更**
- 看板背景改为三层极光光斑 + 网格纹理（`prefers-reduced-motion` 下停止动画），新增品牌色与成功/警告/危险/信息语义色令牌，浅色、深色各一套取值。
- 卡片加入渐变顶线、悬浮上移与阴影过渡；汇总区、页头、加载骨架、空状态、错误面板统一字号与间距层级。
- 空状态「添加账号」说明改为单行显示；`index.html` 描述补充 Qoder。
- 仅视觉与文案调整，业务逻辑、接口与数据结构未变。

**验证**：75/75 单测；`npm run build` 通过；本地浏览器用模拟数据覆盖余额/额度/积分/低余量/失败卡片，实测 1440px 明暗主题、390px 移动端与添加账号弹窗，无控制台错误、无横向溢出。

## [v0.8.2] — 2026-10-28 · Qoder Sites 凭据加密

**新增**
- `functions/storage-crypto.ts`：WebCrypto AES-256-GCM 凭据加密，载荷格式与 AAD 同 `server/data-crypto.ts`（`v1.<iv>.<tag>.<ciphertext>`），密文可在两种部署形态间互读。
- `tests/storage-crypto.test.ts`：加解密往返、篡改/异密钥拒绝、密钥缺失或非法时失败关闭、与自托管密文互通。

**变更**
- `functions/store-storage.ts` 账号文件升级到存储版本 2：`credential` 只保存 `{enc}`，读取时透明解密；存量 version 1 明文条目在首次读取后自动重写为密文。
- `functions/index.ts` 从站点 Secret `PANEL_DATA_KEY`（64 位 hex）构建加密器；未配置时账号接口以 `accounts_unavailable` 失败关闭，不会以明文写入。
- 文档同步：ARCHITECTURE 存储与安全边界、DEPLOYMENT 形态 A 的密钥配置、README 安全基线。

**验证**：75/75 单测；`npm run build` 通过。Qoder Sites 形态自 v0.5.0 起未重新发布，本次未对平台 Storage 实测（该形态仅作备用）；自托管生产仍走 `server/file-store.ts`，存储路径与密钥不变。

## [v0.8.1] — 2026-10-28 · 修复 Qoder 资源包不显示

**修复**
- Qoder 额度响应中的加量包实际位于 `addOnQuota`（`total` / `used` / `remaining` / `percentage`），此前只解析 `orgResourcePackage`，导致卡片只显示套餐额度；现优先读取 `addOnQuota`，并保留 `orgResourcePackage`（含 `cap` 别名）作为旧版/国际版回退。
- 套餐总额缺失时，剩余百分比改用 `userQuota.percentage`（套餐已用比例）推算；`totalUsagePercentage`（套餐 + 加量包合计）仅作最后回退。
- 资源包没有重置时间时不再显示「重置时间未知」，改为「—」。

**验证**：71/71 单测（`addOnQuota` 主路径、`orgResourcePackage` 回退、资源包缺失/不可用时隐藏）；`npm run build` 通过；线上用已存凭据实际调用 Qoder 接口，响应为 `userQuota 167/300` 与 `addOnQuota 200/200`，修复后卡片输出套餐额度与资源包两个窗口。

## [v0.8.0] — 2026-10-28 · Qoder 套餐额度接入

**新增**
- 新增 Qoder（阿里）额度卡片：使用个人访问令牌（PAT，`pt-` 开头）调用官方 OpenAPI `/api/v2/quota/usage`，展示套餐 Credits 剩余、套餐已用与资源包余量；主数字为套餐剩余，窗口展示重置倒计时。
- 凭据流程：先用 PAT 调用 `/api/v1/jobToken/exchange` 兑换临时 job token 再查询额度；已持有的 `dt-` / `jt-` 令牌可直接粘贴，跳过兑换。
- 表单新增站点版本选择：国内版 `openapi.qoder.com.cn`（qoder.cn）与国际版 `openapi.qoder.sh`（qoder.com）。
- 获取说明弹窗与设置页「凭据填写方式」补充 Qoder 条目。

**变更**
- 额度卡片的标题与重置文案改由平台元数据驱动（`quotaHeadline` / `resetWord`）：MiniMax 维持「5 小时剩余 / 刷新」，Qoder 显示「套餐剩余 / 重置」。
- 剩余百分比未知但剩余数值存在时（部分 Qoder 套餐不返回总额），不再误判为「查询失败」，改按剩余数值判断状态。
- 凭据失效文案统一为「凭据无效或已失效，请更新凭据」。
- 设置页 WorkBuddy 凭据说明更正为登录 Cookie 写法，与 v0.6.1 起的实际行为一致。

**验证**：70/70 单测（新增 Qoder 兑换与查询请求形状、国际版直连、兑换 400 / 查询 401 → `invalid_key`、缺字段 → `bad_response`、资源包不可用时隐藏、账号创建时区域落库）；`npm run build` 通过；本地浏览器验证添加弹窗、版本选择、获取说明、卡片明暗主题，以及伪 token 触发的真实上游错误态（请求 `openapi.qoder.com.cn` 返回凭据失效）。真实 PAT 的成功查询需用户创建令牌后于线上确认。

## [v0.7.2] — 2026-10-28 · 精简页脚与备案信息

**变更**
- 看板页脚由五段口语化说明压缩为两行：服务端存储与代查、30 秒缓存与手动刷新、渠道标注与排序同步。
- 新增全站页脚：版权信息与备案号展示（备案号由构建变量注入，未设置时自动隐藏），链接工信部备案系统；登录页同步展示。

**验证**：63/63 单测通过；`npm run build` 通过；本地浏览器检查看板与登录页页脚排版。

## [v0.7.1] — 2026-10-28 · 修复旧凭据导致账号库读取失败

**修复**
- 账号库读取改为容忍旧版凭据：平台鉴权方式变更后（如硅基流动由 API Key 改为登录 Cookie），存量账号不再触发整库 `account_store_unavailable`，仅该卡片显示「登录凭据已失效，请更新凭据」，其余账号正常刷新。
- 新增 `tests/accounts.test.ts`：旧凭据保留、当前格式归一化、空凭据拒绝。

**验证**：63/63 单测通过；线上修复后账号库读取恢复（6 个账号），旧 Key 的硅基流动账号单独返回凭据失效，看板其余卡片正常。

## [v0.7.0] — 2026-10-28 · 查询渠道标注与卡片排序

**新增**
- 每张卡片标注余额查询渠道：官方 API 使用 API Key 查询，控制台接口使用登录 Cookie 查询；悬停可查看具体接口说明，「如何获取凭据」弹窗新增「查询渠道」分区。
- 卡片支持自定义排序：按住右上角手柄拖动即可换位，卡片菜单同时提供「前移 / 后移」（无障碍与触屏备用）；顺序写入服务端设置，刷新或换设备后保持一致。

**变更**
- 设置接口新增可选 `order` 字段（账号 ID 数组，自动去重，上限 500 项）；旧设置缺少该字段时自动补空数组，无需迁移。

**验证**：60/60 单测（order 解析与去重、非法值拒绝、路由持久化）；`npm run build` 通过；本地浏览器实测真实鼠标拖动换位、菜单「后移」生效，刷新后顺序保持，服务端设置已落盘 order。

## [v0.6.1] — 2026-10-28 · WorkBuddy 登录 Cookie 接入

**变更**
- WorkBuddy 改为使用控制台登录 Cookie（`session` + `session_2`）查询积分：请求 `https://www.workbuddy.cn/billing/meter/get-user-resource`（国际版 `www.workbuddy.ai`），带浏览器 User-Agent 与 `x-client-platform: web`（网关对非浏览器 UA 直接 401）。
- 添加/编辑弹窗的 WorkBuddy 表单从「Authorization Token + 用户 ID」改为单个「登录 Cookie」字段，并校验长度；版本选项文案更新为 `workbuddy.cn` / `workbuddy.ai`。
- 获取说明改为从个人中心「积分用量」页的 billing 请求里复制 `session` 与 `session_2`；说明 Cookie 会随会话轮换或过期，失效后重新复制。
- 旧的 bearer 令牌账号仍可查询（走 `/v2/billing/...`），无需迁移。
- 卡片文案对齐控制台口径：主数字为「累计剩余积分」，明细为「累计获得 / 累计已用」；WorkBuddy 由多个积分包组成、各包到期时间不同，不再展示到期时间。
- 移除看板底部「暂不支持实时查询的平台」区块。
- 硅基流动：官方 API Key 余额接口 `/v1/user/info` 已于 2026-08-14 下线（410 code 20092，暂无替代接口），改为使用控制台登录 Cookie 查询（先取 subjectId，再读钱包 `financialInfo`）；表单改为单个「登录 Cookie」字段，说明同步更新。

**验证**：57/57 单测（新增 WorkBuddy Cookie 请求形状、旧令牌回退、401 → `invalid_session`、凭据录入与非法字符拒绝）；`npm run build` 通过；线上实测 WorkBuddy 返回剩余 3,611.11 / 总额 11,011，硅基流动控制台接口返回 ¥2.8028，均与控制台一致。

## [v0.6.0] — 2026-10-28 · 凭据加密存储与运行面收紧

**新增**
- `server/data-crypto.ts`：AES-256-GCM 凭据加密（12 字节随机 IV + 认证标签，AAD 固定 `token-panel:credential:v1`）。密钥优先取 `PANEL_DATA_KEY`（64 位 hex），否则首启生成 `data/data-key`（0600）。
- `server/file-store.ts`：文件存储从 `server/index.ts` 抽出，账号文件升级到存储版本 2（`credential: { enc: "v1.<iv>.<tag>.<ct>" }`），id/平台/标签保持可读便于运维。
- 存量明文账号在首次读取时自动重写为密文（一次性迁移，无需手工操作）。
- `deploy/backup.sh`：`data/` 目录 tar 打包后经 openssl AES-256-CBC（PBKDF2，200k 迭代）加密输出，权限 600。

**变更**
- 数据文件统一 0600 写入（`accounts.json`、`settings.json`、`auth.json` 及临时文件）。
- 容器改为以 `node`（uid 1000）运行，`/opt/token-panel/data` 归属 1000:1000；宿主上 root 之外的进程无法读取数据文件。
- compose 增加 `PANEL_DATA_KEY` 透传，允许把数据密钥放在数据目录之外。

**验证**：49/49 单测（含加解密往返、篡改/错密钥拒绝、明文迁移、密钥文件权限、存储读写）；本地起服务新增账号后 `accounts.json` 无明文且为 v2；线上重建镜像后容器 `uid=1000(node)`、`/data` 全 600、健康检查 200、真实账号写入后落盘为密文且可解密读取。

## [v0.5.0] — 2026-10-28 · 应用内登录与密码管理

**新增**
- 自托管鉴权体系 `server/auth.ts`：scrypt 密码哈希（`data/auth.json`）、HMAC-SHA256 会话令牌（密钥落盘 `data/session-secret`，0600）、会话 Cookie `panel_session`（HttpOnly/Secure/SameSite=Lax，7 天）。
- 鉴权路由 `/api/auth/{login,logout,status,password}`；登录限流 10 次/分钟/IP；密码长度 8..128 校验。
- 前端登录页 `components/login-view.tsx`（与面板同一设计语言，支持明暗主题）；`lib/auth.ts` API 封装。
- 设置面板新增"安全"分区：当前用户名与会话有效期展示、修改密码表单（当前/新/确认三项校验）、退出登录按钮；登出时主动清除浏览器本地缓存。

**变更**
- nginx vhost 移除 Basic 认证（浏览器原生弹窗 → 应用内登录页）；静态资源公开，API 全部需要会话。
- `lib/request.ts`：401/403 时优先解析响应体 error 码映射中文文案，保持无 body 时的旧文案兼容。
- 任意 API 返回 401 `login_required` 时前端自动切回登录页。

**修复**
- `server/index.ts`：requireUser 漏调用 Cookie 解析导致带 Cookie 仍 401（线上冒烟发现并修复）。
- `verifyPassword` 对畸形哈希（空 hex buffer）误判通过 → 增加 64 字节哈希长度校验（单测覆盖）。
- 首次部署时服务器 compose 未透传 PANEL_PASSWORD，导致随机种子密码 → compose 增加环境变量透传并重新种子。

**验证**：41/41 单测通过；本地端到端（登录/错密码 401/改密后旧密码失效/限流）；线上 curl 全链路 + 浏览器实测（登录页 → 登录 → 看板 → 安全分区）。

## [v0.4.0] — 2026-10-27 · 自托管部署上线

**新增**
- Node 24 自托管宿主 `server/index.ts`（原生 TS type stripping）：文件版账号/设置存储（原子写）、`application()` 装配、请求体有界缓冲。
- Docker 化：`deploy/Dockerfile.api`（node:24-alpine）+ `deploy/compose.yml`，API 仅绑定 `127.0.0.1:8010`。
- 服务器部署：宿主宝塔 nginx 新增面板域名的独立 vhost（静态 + API 反代 + 安全响应头 + SPA 回退），acme.sh 签发 Let's Encrypt 证书并挂自动续期。
- 临时 Basic 认证（后续 v0.5.0 移除）。

**关键决策**
- 宿主 80/443 由宝塔 nginx 占用 → 放弃容器内 Caddy 反代方案，改为 nginx vhost + 回环端口容器，博客等其他站点零影响。

**验证**：本地构建 + 容器健康检查 + 线上 curl（301/401/200/证书链）；部署过程修复 htpasswd 权限导致的隐性 500。

## [v0.3.0] — 2026-10-27 · 稳定性与安全加固

**新增**
- 服务端权威设置：`GET/PUT /api/settings`，刷新频率 + 各平台低余量提醒线；前端 500ms 防抖 + 串行保存队列 + 本地副本加速。
- 服务端余额缓存：每用户 30s TTL、上限 2000 条、并发 single-flight、`refresh=1` 绕过、账号变更时失效；卡片显示"服务端缓存"标记。
- 每用户固定窗口限流（读 120/min、写 30/min），超限 429 + Retry-After。
- 浏览器缓存分层：localStorage 设置副本 + sessionStorage 看板快照（24h、不含凭据）；头部显示数据来源（服务端/浏览器快照）。
- 自动化测试套件（node:test，32 用例）：路由行为、缓存、限流、设置校验、会话 Cookie 解析。

**修复**
- 锁注册表：替换无界 `Map` 为空闲自动清理实现（防规模测试内存膨胀）。
- 上游并发上限 8（`mapLimit`）。
- 会话解析拒绝含内部 `=` 的非会话 Cookie（`tr_ref_device` 误判问题）。

**验证**：32/32 单测；Playwright 视觉与缓存行为验证；Qoder Sites 重新发布（内部发布编号已隐去）。

## [v0.2.0] — 2026-10-26 · 账号持久化与新平台接入

**新增**
- 账号持久化后端：Qoder Storage 按用户隔离存储，账号 CRUD（`POST/PATCH/DELETE /api/accounts`，上限 40 个），手动添加空状态。
- 基元律动（TokenRhythm）接入：`tr_session` 会话 Cookie 查询余额；凭据指南引导从 DevTools 复制。
- WorkBuddy 接入：Bearer 令牌 + X-User-Id 双字段凭据。
- 凭据"如何获取"帮助弹窗（按平台区分 API Key / 会话 Cookie / 令牌三类指引）。

**修复**
- `tr_ref_device` 等 Cookie 被误当会话值 → 会话规范化校验。

**验证**：本地功能验证后发布私有站点。

## [v0.1.0] — 2026-10-26 · 项目起步

**新增**
- React 19 + Vite 8 + TypeScript 5.9 + Tailwind v4 前端，基于 Qoder Sites starter。
- Deno Edge Function 余额查询（DeepSeek / Kimi / 硅基流动 / OpenRouter / MiniMax）。
- 看板主界面：汇总栏 + 平台卡片 + 相对时间刷新；明暗主题切换。
- Qoder Sites 私有站点发布。
