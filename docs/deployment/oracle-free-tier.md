# Oracle Cloud Always Free 部署（ARM Ampere A1）

> 把整套 Contritas（web + api + worker + Postgres + Redis + Caddy）跑在 Oracle 永久免费实例上，基础设施 $0/月。
>
> 相关：[Docker 部署指南](./docker.md) ｜ [发布流程](./release.md) ｜ 部署产物：[`deploy/oracle-free-tier/`](../../deploy/oracle-free-tier/)

---

## 一、为什么选 Oracle Always Free

| 项 | Always Free 配额 | 用途 |
| --- | --- | --- |
| Compute (ARM Ampere A1) | **4 OCPU + 24GB RAM**（总配额，可拆 1-4 台 VM） | 跑全部 5 个服务 + Caddy |
| Boot Volume | 200GB 总额度 | 单台拉到 100GB 跑 Postgres + 镜像缓存 |
| Object Storage | 标准 20GB + 归档 10GB | Postgres 定时备份 |
| 出口流量 | 10TB/月 | 远超个人项目所需 |
| Reserved Public IPv4 | 2 个 | 实例重启 IP 不变 |
| 时长 | **永久免费**，不是 trial | 不会到期，唯一风险是空闲回收 |

对比基准：Hetzner CX22 同配置约 $5/月、Railway 起步 ~$5 + 用量、Vercel + Neon + Upstash 拼起来到 $35+/月（详见上轮讨论）。

### 真实风险

1. **账号审核刷信用卡**：用 Visa/Mastercard 实体卡通过率高，虚拟卡/银联易被拒。一次过最重要，被拒申诉很慢。
2. **Region 选定后不可改**：注册时定的 home region 才有 Always Free，建议按地理位置选——亚洲选**新加坡 / 东京**，欧美选**法兰克福 / Phoenix**。国内访问就近选东京。
3. **空闲回收**：连续 7 天 CPU<20% AND network<20% AND memory<10% **三项全部**低于阈值才回收。正常用户访问基本不会触发，本文 §11 还有 keepalive 双保险。

---

## 二、规划与创建实例

**推荐配置：单台 4 OCPU + 24GB RAM 大 VM**，不要拆。理由：5 个服务互相通信走内网最简单，24GB 内存留足 worker 跑多并发的余量。

控制台 → Compute → Instances → Create instance：

| 字段 | 值 |
| --- | --- |
| Image | Canonical Ubuntu 24.04（aarch64） |
| Shape | `VM.Standard.A1.Flex`，OCPU = 4，Memory = 24 GB |
| Networking | 默认 VCN，Assign a public IPv4 = Yes |
| SSH keys | 粘贴你的 `~/.ssh/id_ed25519.pub` |
| Boot volume | 展开「Custom boot volume size」→ 100GB |

### 2.1 Reserve 静态 IP（必做）

默认 public IP 是 ephemeral，实例 stop/start 后会变。

Networking → Reserved Public IPs → Reserve a Public IP → 选刚创建的 VNIC 上的 ephemeral IP → 提升为 reserved。

### 2.2 Security List 放行 80/443

Networking → VCN → Default Security List → Add Ingress Rule：
- Source `0.0.0.0/0`, IP Protocol = TCP, Destination Port = `80`
- Source `0.0.0.0/0`, IP Protocol = TCP, Destination Port = `443`

22 默认已开。

---

## 三、系统初始化（关键：iptables）

SSH 进去：`ssh ubuntu@<reserved-ip>`

```bash
# ⚠️ Oracle Ubuntu 镜像 iptables 默认 INPUT DROP
# 仅在 Security List 开 80/443 不够，宿主机也要 ACCEPT，否则永远连不通
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# 24GB 内存够用，仍建议加 4G swap（worker 跑长 LLM 上下文偶有尖峰）
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker
sudo apt update && sudo apt install -y ca-certificates curl jq
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# 验证 multi-arch 镜像能正确选 arm64
docker run --rm hello-world
```

> **iptables 那一步漏掉的症状**：`curl http://<ip>` 永远 timeout，但 Oracle 控制台显示实例 running、Security List 也开了。新手最常踩。

---

## 四、域名与 DNS

两条 A 记录指到 Reserved IP：
- `app.example.com` → `<reserved-ip>`（前端）
- `api.example.com` → `<reserved-ip>`（后端 + SSE）

如果用 Cloudflare 托管 DNS，**关闭橙色云（DNS only）**。CF Proxy 会破坏 SSE 长连接，等流量上来再单独配 Argo Tunnel。

---

## 五、克隆部署目录

```bash
cd ~
git clone https://github.com/xgyyx/contritas.git
cd contritas/deploy/oracle-free-tier
```

目录里已经备好的文件：

| 文件 | 作用 |
| --- | --- |
| `docker-compose.yml` | 锁 `platform: linux/arm64`，拉 GHCR 镜像，加 Caddy 反代 |
| `Caddyfile` | 自动 TLS + SSE 长连接配置 |
| `.env.example` | 环境变量模板 |
| `backup.sh` | Postgres → Oracle Object Storage |
| `keepalive.sh` | 防回收 cron |

---

## 六、写 `.env`

```bash
cp .env.example .env
chmod 600 .env
vim .env
```

关键值：

```bash
DOMAIN=example.com
APP_VERSION=0.7.1                              # 看 https://github.com/xgyyx/contritas/releases

POSTGRES_PASSWORD=<openssl rand -hex 24>
API_AUTH_TOKEN=<openssl rand -hex 32>          # ⚠️ 必须包含 web 镜像 build-time 烤入的 token

LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-xxx
LLM_MODEL_CHEAP=claude-haiku-3-5-20241022      # 省 token 关键

TAVILY_API_KEY=tvly-xxx
```

---

## 七、处理 web 镜像的 build-time URL

`NEXT_PUBLIC_API_URL` 是 Next.js build-time 烤进 JS bundle 的常量。GHCR 上的 `contritas-web` 镜像默认用 repo Variables `RELEASE_NEXT_PUBLIC_API_URL` 烤的值，**如果与你部署目标不符，前端会请求错地址**。两个解法：

**方案 A（推荐）：改 GitHub repo 配置后重发版**

1. repo Settings → Secrets and variables → Actions → Variables：
   - `RELEASE_NEXT_PUBLIC_API_URL` = `https://api.example.com`
2. → Secrets：
   - `RELEASE_NEXT_PUBLIC_API_TOKEN` = `<.env 里 API_AUTH_TOKEN 同值>`
3. 按 `docs/deployment/release.md` §四的流程开 release PR、merge、出新 tag。

**方案 B：VPS 本地 build 一个 web 镜像**

```bash
cd ~/contritas
docker build --platform linux/arm64 -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_API_TOKEN=$(grep '^API_AUTH_TOKEN=' deploy/oracle-free-tier/.env | cut -d= -f2-) \
  -t contritas-web:local .

# 然后 deploy/oracle-free-tier/docker-compose.yml 里 web.image 改成 contritas-web:local
```

---

## 八、启动与验证

```bash
cd ~/contritas/deploy/oracle-free-tier

docker compose pull
docker compose up -d
docker compose logs -f api worker        # 看迁移和首次启动日志
```

第一次 Caddy 申请 Let's Encrypt 证书要 30-60 秒。

验证：

```bash
curl https://api.example.com/health
# {"status":"ok","db":"ok","redis":"ok","timestamp":"..."}
```

浏览器打开 `https://app.example.com`，跑一次完整研究流程。

---

## 九、健康检查与故障排查

```bash
docker compose ps                              # 看每个服务 STATUS = healthy
docker compose logs --tail=200 caddy           # Caddy TLS / 反代日志
docker compose logs --tail=200 api worker      # 业务日志
docker compose exec postgres psql -U postgres -d contritas -c '\dt'   # 看表
```

常见症状：

| 症状 | 可能原因 | 处理 |
| --- | --- | --- |
| `curl https://api.example.com` 拒连/超时 | iptables 没改 / Security List 没开 / DNS 没生效 | 第 3 步 iptables / 第 2.2 Security List / `dig api.example.com` |
| Caddy 反复申请证书失败 | DNS 未指向当前 IP、80 端口未通、Let's Encrypt 频次限流 | 检查 DNS + iptables；如限流等几小时 |
| 前端能打开但 API 请求 401 | web 镜像 build-time token 与 `.env` API_AUTH_TOKEN 不一致 | 见第 7 步 |
| 前端能打开但请求打到错地址 | web 镜像 build-time URL 与实际域名不符 | 见第 7 步 |
| Health 返回 503 | Postgres / Redis 未就绪 | `docker compose ps` 看 healthcheck；可能容器在重启 |
| Worker 启动后又退出 | RUN_MIGRATIONS=true 同时跑了 → 抢 advisory lock | 检查 compose worker.environment 是否 `RUN_MIGRATIONS: "false"` |

---

## 十、备份：Oracle Object Storage

Always Free 含 20GB 标准 + 10GB 归档桶，**免出口费**（实例内网传输），不需要额外用 R2 / B2。

### 10.1 创建桶

控制台 → Storage → Buckets → Create Bucket：
- Name: `contritas-backup`
- Default Storage Tier: Standard
- 其余保持默认（私有访问）

### 10.2 配 OCI CLI

```bash
sudo apt install -y python3-pip
pip3 install --break-system-packages oci-cli

oci setup config
# 按引导粘贴 Tenancy OCID、User OCID、Region
# 它会生成 API key，把 .oci/oci_api_key_public.pem 内容粘到控制台
# Identity → Users → 你的用户 → API Keys → Add API Key
```

验证：

```bash
oci os ns get                                  # 应返回你的 namespace
oci os object list -bn contritas-backup        # 空列表 = OK
```

### 10.3 配 cron

```bash
crontab -e
# 加一行（每天 03:17，避开整点）
17 3 * * * BACKUP_BUCKET=contritas-backup /home/ubuntu/contritas/deploy/oracle-free-tier/backup.sh >> /home/ubuntu/backup.log 2>&1
```

`backup.sh` 自动保留最近 30 天（可用 `BACKUP_RETENTION_DAYS` 调），超期的 Object 自动删除。

### 10.4 灾难恢复

```bash
# 拉某个备份回来
oci os object get -bn contritas-backup --name db-20260525-0317.sql.gz --file /tmp/restore.sql.gz

# 灌回 DB
gunzip -c /tmp/restore.sql.gz | docker compose exec -T postgres psql -U postgres -d contritas
```

---

## 十一、防 Always Free 回收（保险）

虽然跑了完整后端栈基本不会触发回收阈值，加个 cron 双保险：

```bash
crontab -e
# 加一行
*/30 * * * * APP_DOMAIN=example.com /home/ubuntu/contritas/deploy/oracle-free-tier/keepalive.sh >/dev/null 2>&1
```

`keepalive.sh` 每 30 分钟 curl 一次 `/health`（制造 network 流量）+ 短促 CPU/IO burst（约 100MB）。

---

## 十二、升级版本

```bash
cd ~/contritas/deploy/oracle-free-tier

# 编辑 .env，改 APP_VERSION=0.8.0
docker compose pull
docker compose up -d
```

- API 启动时自动跑 drizzle migrate
- Worker 等 api healthy 再起，不抢 advisory lock
- 回滚：`APP_VERSION` 改回老版本号 → `up -d`（前提是 schema 兼容）

升级前别忘 `git pull` 一下 deploy 目录，可能 compose / Caddyfile 有更新：

```bash
cd ~/contritas && git pull
```

---

## 十三、成本核算

| 项 | 月成本 |
| --- | --- |
| Oracle ARM VM (4C24G) | **$0** |
| Boot Volume 100GB | $0 |
| Reserved IP（attached） | $0 |
| Object Storage 备份 (~1GB) | $0 |
| 出口流量 (<10TB) | $0 |
| 域名（摊月） | $0.8 |
| **基础设施合计** | **~$1/月** |
| Anthropic / Tavily API | 按用量；Haiku-3.5 + Tavily 单次完整研究约 $0.05-0.3 |

---

## 十四、Oracle 特有坑总结

| 症状 | 原因 | 修法 |
| --- | --- | --- |
| Security List 开了但外面连不通 | Ubuntu 镜像 iptables 默认 DROP | §3 iptables 两行 |
| 重启实例后 IP 变了 | Public IP 默认 ephemeral | §2.1 Reserve IP |
| 信用卡注册被拒 | Oracle 风控严，虚拟卡/银联通过率低 | Visa/MC 实体卡，一次过 |
| 几个月后实例消失 | Always Free 空闲回收 | §11 keepalive cron |
| 拉镜像拉到 amd64 | 个别旧版 docker manifest 解析问题 | compose 已显式 `platform: linux/arm64` |
| Region 选错访问慢 | Always Free 只能在 home region | 注册前定好，**不可改** |

---

## 十五、什么时候迁出 Oracle

设几个触发点免得提前过度工程化：

- 用户开始抱怨延迟（跨境慢） → web 迁 Vercel（API 仍在 Oracle，CORS 改一下）
- Postgres > 5GB 或备份不放心 → 迁 Neon Pro ($19/月)
- 单 worker 跑不过来 → Oracle Free 配额允许再起一台 VM 跑额外 worker（共享 Redis 即可，BullMQ 天然支持多 worker）
- 实例被回收且申诉无果 → 迁 Hetzner CX22 ($5)，compose 几乎不用改
