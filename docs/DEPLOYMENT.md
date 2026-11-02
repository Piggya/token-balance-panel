# 部署与运维手册

> 覆盖两种部署形态的发布流程、线上验证、备份与回滚。发布前先完成 [DEVELOPMENT](DEVELOPMENT.md) §3 的测试与验证。

## 1. 形态 A：Qoder Sites（可选）

状态：v0.5.0 之后未再更新发布，自托管为当前推荐形态，此节仅作托管方式说明。

1. `npm run build` 产出 `dist/`；Function 目录为 `functions`，web 目录为 `dist`；鉴权依赖站点访客身份。
2. 通过 Qoder Sites 的站点管理能力准备并发布站点，函数与静态目录按上一条配置；发布后确认状态正常。
3. **凭据加密密钥**：首次发布前在 Site Settings 配置 Secret `PANEL_DATA_KEY`（64 位 hex，`openssl rand -hex 32` 生成），确认同步完成后再发布。未配置时账号接口以 `accounts_unavailable` 失败关闭；该密钥是凭据密文唯一解密依据，需自行妥善备份，轮换会使既有凭据不可读。

## 2. 形态 B：自托管（推荐）

### 2.1 拓扑

```
浏览器 ──HTTPS(443)──► 宿主机反向代理（nginx / Caddy）
                        ├─ /                    → dist/ 静态文件
                        └─ /functions/v1/app/*  → 127.0.0.1:8010（token-panel-api 容器）
容器：node:24-alpine，server/index.ts，DATA_DIR=/opt/token-panel/data
TLS：任意 ACME 客户端（示例为 acme.sh + Let's Encrypt）
```

下文命令以「Linux + nginx + acme.sh」为例，路径按自己的发行版与面板替换：

- 服务器：`<SERVER_IP>`，SSH 密钥登录：`ssh -i ~/.ssh/panel_key <DEPLOY_USER>@<SERVER_IP>`。示例用 root 便于起步；生产建议普通用户 + sudo，并关闭 root 远程登录。
- 部署根目录：`/opt/token-panel`（代码 + `data/` 数据 + `compose.yml`）
- 静态站点目录：示例为 `/www/wwwroot/token-panel`（宝塔面板默认）；裸装 nginx 常用 `/var/www/token-panel`
- nginx vhost：示例为 `/www/server/panel/vhost/nginx/panel.example.com.conf`（宝塔面板路径）；裸装 nginx 在 `/etc/nginx/conf.d/`
- 证书：由 acme.sh 安装到 nginx 的 cert 目录（示例 `/www/server/panel/vhost/cert/panel.example.com/`，源为 `/root/.acme.sh/panel.example.com_ecc/`）
- 宿主机反向代理已占用 80/443 时，容器只监听回环地址即可，不要叠加第二层反向代理；同机还有其他站点时，只新增本面板的 vhost，避免改动其他站点的配置。
- 仓库里的 `deploy/Caddyfile` 是 Caddy 版反代示例，可与 `deploy/compose.yml` 配合使用。

### 2.2 发布流程

本地：

```sh
npm test && npm run build        # 必须全绿
```

> 页脚备案号是可选的构建变量：把 `VITE_ICP_NUMBER=...` 写进本地 `.env.local`（已 gitignore，示例见 `.env.example`），构建时由 Vite 内联；不设置则页脚只显示版权。仓库本身不含具体备案号。

```sh
tar -czf /tmp/token-panel.tar.gz dist functions server deploy package.json
scp -i ~/.ssh/panel_key /tmp/token-panel.tar.gz <DEPLOY_USER>@<SERVER_IP>:/tmp/
```

服务器：

```sh
cd /opt/token-panel
tar -xzf /tmp/token-panel.tar.gz && rm -f /tmp/token-panel.tar.gz
docker compose up -d --build                 # 重建 API 容器
cp -r /opt/token-panel/dist/. /www/wwwroot/token-panel/   # 站点读的是静态目录副本，构建后需同步
cd /www/wwwroot/token-panel/assets && ls     # 清理不再被 index.html 引用的旧 hash 资产（可选）
```

> 如果同一 shell 里为备份设置过 `umask 077`，新拷贝的文件会是 600，nginx 对哈希资源返回 403（v0.8.4 部署时踩到）。拷贝前先 `umask 022`，或事后执行 `chmod -R a+rX /www/wwwroot/token-panel`。

### 2.3 线上验证清单

```sh
B=https://panel.example.com
curl -s -o /dev/null -w "%{http_code}\n" $B/                                   # 200（登录页公开）
curl -s $B/functions/v1/app/api/auth/status                                    # authenticated:false
curl -s -o /dev/null -w "%{http_code}\n" $B/functions/v1/app/api/dashboard     # 401
curl -s -c cj -H 'Content-Type: application/json' \
  -d '{"username":"...","password":"..."}' $B/functions/v1/app/api/auth/login  # ok:true
curl -s -b cj -o /dev/null -w "%{http_code}\n" $B/functions/v1/app/api/dashboard  # 200
rm -f cj
```

浏览器：登录页渲染 → 登录 → 看板 → 设置"安全"分区可见。发布后确认 `docker logs token-panel-api` 无异常输出。

### 2.4 环境变量与首次初始化

`/opt/token-panel/compose.yml`：

| 变量 | 作用 |
| --- | --- |
| `PORT` / `DATA_DIR` | 容器内监听端口（8000）与数据目录（/data） |
| `PANEL_USERNAME` / `PANEL_PASSWORD` | **仅首次**种子 `data/auth.json`（密码 ≥8 位；缺失则生成随机密码打印到容器日志一次） |
| `PANEL_DATA_KEY` | 凭据加密主密钥（64 位 hex）。留空则使用 `data/data-key` |

重置面板密码：`rm data/auth.json` 后带环境变量 `docker compose up -d`，或直接在网页"设置 → 安全"改密。

### 2.5 凭据加密与密钥管理

平台 API Key 以 AES-256-GCM 加密后写入 `data/accounts.json`（存储版本 2，`credential: { enc: "v1.<iv>.<tag>.<ct>" }`），运行时才在内存解密；接口只返回账号摘要，凭据永不下发浏览器。

密钥来源二选一：

| 方式 | 位置 | 取舍 |
| --- | --- | --- |
| 默认 | `data/data-key`（0600，首次启动生成） | 备份自包含，恢复简单；与密文同目录，防的是文件外泄而非宿主 root |
| 推荐（更强） | `.env` 中 `PANEL_DATA_KEY=<64位hex>` | 密钥可与数据目录分离保管；**备份必须同时保存密钥**，否则密文不可恢复 |

```sh
# 生成并写入 .env（0600）
openssl rand -hex 32 | sed 's/^/PANEL_DATA_KEY=/' > /opt/token-panel/.env
chmod 600 /opt/token-panel/.env && cd /opt/token-panel && docker compose up -d
```

- 密钥必须能被持续使用：一旦丢失，`accounts.json` 无法解密，只能删除后重新录入各平台凭据。
- 轮换密钥：先在原密钥可读的情况下改回默认密钥文件或写入新 `.env`，再通过 `POST /api/accounts` 逐个重写账号（或删除 `accounts.json` 后重新录入）。
- 旧版明文 `accounts.json`（version 1）会在首次读取时自动重写为密文，无需手工迁移。
- 容器以 `node`（uid 1000）运行，`data/` 归属 1000:1000，数据文件一律 0600；变更属主后需重启容器。

## 3. 备份与回滚

### 3.1 备份（改动前必做）

```sh
# 加密备份（推荐）：输出 token-panel-<时间戳>.tar.gz.enc，权限 600
PANEL_BACKUP_PASSWORD='<备份口令>' /opt/token-panel/deploy/backup.sh

# 恢复
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:PANEL_BACKUP_PASSWORD \
  < token-panel-<时间戳>.tar.gz.enc | tar -C /opt/token-panel -xzf -

# 配置文件独立备份（不含数据）
cp /www/server/panel/vhost/nginx/panel.example.com.conf /opt/token-panel-backup-vhost-$(date +%Y%m%d).conf
```

数据即 `data/` 下：`accounts.json`（加密后的平台凭据+账号）、`settings.json`、`auth.json`（面板密码哈希）、`session-secret`（会话密钥）、`data-key`（未使用 `PANEL_DATA_KEY` 时的加密密钥）。`data-key` 与 `accounts.json` 必须成对备份。

### 3.2 回滚

- **应用回滚**：本地切到上一版本代码，重走 §2.2（容器重建 + dist 同步）；数据目录不动。
- **回滚到 v0.5.0 及更早**：旧版本无法读取 version 2（密文）账号文件，回滚前必须恢复备份中的旧数据，或回滚后删除 `data/accounts.json` 重新录入凭据。
- **完全移除面板**：`cd /opt/token-panel && docker compose down`，删除 `/www/server/panel/vhost/nginx/panel.example.com.conf`，`nginx -t && nginx -s reload`，删除 `/www/wwwroot/token-panel`。不影响同机其他站点。
- **证书续期异常**：`/root/.acme.sh/acme.sh --renew -d panel.example.com --ecc`；续期已挂 reload 钩子，通常无需手工干预。

## 4. 安全清单

- [ ] 云厂商安全组/主机防火墙只放行 22/80/443（安全组是真正的边界）
- [ ] SSH 仅密钥登录并禁用密码登录；不要把密码写进命令行、脚本或日志，怀疑泄露时立即更换
- [ ] 面板密码强度 ≥8 位，部署后尽快从种子密码改掉
- [ ] HTTPS 证书有效（`openssl s_client` 检查 notAfter）
- [ ] `docker inspect token-panel-api` 确认端口映射为 `127.0.0.1:8010->8000`，无 `0.0.0.0` 暴露
- [ ] nginx vhost 保留安全响应头（HSTS / nosniff / DENY / same-origin referrer）
- [ ] 容器以 `node`（uid 1000）运行：`docker exec token-panel-api id`
- [ ] `data/` 归属 1000:1000，文件权限 600（`ls -ln /opt/token-panel/data`）
- [ ] `accounts.json` 为存储版本 2 且 `credential` 只有 `enc` 字段；`data-key` 或 `PANEL_DATA_KEY` 可正常读取
- [ ] 备份加密文件同机留存至少一份，且密钥/口令另行保管

## 5. 故障速查

| 现象 | 排查 |
| --- | --- |
| 全站 500 且无错误日志 | 历史：htpasswd/vhost 文件对 nginx worker（www 用户）不可读。检查文件权限 |
| 登录报 `invalid_credentials` 但密码正确 | 容器日志若出现 "generated panel password" 说明 `auth.json` 被重建且未带环境变量 → 按 §2.4 重置 |
| 看板 401 循环 | `session-secret` 被删/重建导致旧 Cookie 失效，重新登录即可；前端本地缓存异常时清 sessionStorage |
| 单平台卡片"查询失败" | 平台接口变更或凭据过期；先在卡片"更新凭据"，仍失败再看平台侧策略 |
| API 全部 503 | `accounts_unavailable`/`settings_unavailable`：检查 `data/` 目录写权限与磁盘空间 |
| 账号接口 503 且日志报 `cannot initialise credential key` | 密钥缺失或不匹配：设置正确的 `PANEL_DATA_KEY`，或从备份恢复 `data/data-key`；不要删除 `accounts.json` 以外的东西 |
| 容器启动即退出（exit 1） | 同上，密钥初始化失败会主动退出以避免用错密钥写坏数据 |
