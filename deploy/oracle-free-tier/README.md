# Oracle Cloud Always Free 部署（ARM Ampere A1）

> 用 Oracle Always Free 配额跑完整 Contritas 后端栈，基础设施 $0/月。
> 完整步骤、坑位、备份策略详见 [`docs/deployment/oracle-free-tier.md`](../../docs/deployment/oracle-free-tier.md)。
> 本目录只放可直接用的部署产物。

## 目录文件

| 文件 | 作用 |
| --- | --- |
| `docker-compose.yml` | 5 服务编排（pg/redis/api/worker/web）+ Caddy，全部锁 `platform: linux/arm64`，拉 GHCR 镜像不本地 build |
| `Caddyfile` | 反代 + 自动 Let's Encrypt TLS；SSE 端点单独配置不缓冲、24h 长连接超时 |
| `.env.example` | 环境变量模板，含 LLM/搜索/鉴权所有必填项 |
| `backup.sh` | `pg_dump` → Oracle Object Storage（Always Free 含 20GB 桶） |
| `keepalive.sh` | 防 Always Free 空闲回收（每 30 分钟探活 + 短促 CPU burst） |

## 最小启动步骤

详细解释（含 iptables 坑、Reserve IP、Object Storage 桶创建等）见 [完整文档](../../docs/deployment/oracle-free-tier.md)。

```bash
# 在 Oracle ARM 实例上
git clone https://github.com/xgyyx/contritas.git
cd contritas/deploy/oracle-free-tier

cp .env.example .env
chmod 600 .env
# 编辑 .env：DOMAIN / APP_VERSION / POSTGRES_PASSWORD / API_AUTH_TOKEN / ANTHROPIC_API_KEY / TAVILY_API_KEY

docker compose pull
docker compose up -d
docker compose logs -f api worker

# 验证
curl https://api.example.com/health
```

## 注意

- **`app.${DOMAIN}` 与 `api.${DOMAIN}` 都需先在 DNS 解析到 VPS IP**，否则 Caddy 申请证书失败。
- **`NEXT_PUBLIC_API_URL` 是 build-time 烤进 web bundle 的常量**。GHCR 上的 `contritas-web` 镜像默认用 repo Variables `RELEASE_NEXT_PUBLIC_API_URL` 烤的值，如果与你的实际域名不符，前端会请求错地址 —— 必须先在 GitHub repo Settings 改对再重发版，或本地 build 一个 `contritas-web:local` 镜像替换。详见 `docs/deployment/release.md` §八。
- **`API_AUTH_TOKEN` 必须包含 `RELEASE_NEXT_PUBLIC_API_TOKEN`**，否则前端鉴权会被服务端拒。
- **Oracle Ubuntu 镜像的 iptables 默认 DROP**，光在 Security List 开 80/443 不够，宿主机也得 ACCEPT。完整文档第 3 步必看。

## 升级版本

```bash
# 编辑 .env 改 APP_VERSION=0.8.0
docker compose pull
docker compose up -d
```

API 容器启动时自动跑 drizzle migrate；worker 等 api healthy 再起，不会与迁移争 advisory lock。
