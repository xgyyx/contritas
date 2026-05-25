# Docker 部署指南

> 容器化构建、生产运行、环境配置与运维参考。
>
> 相关文档：[基础设施](../architecture/realtime-and-infra.md) | [数据模型](../architecture/data-model.md) | 代码：`apps/api/Dockerfile`、`apps/web/Dockerfile`

---

## 一、架构概览

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   web:3000  │───▶│  api:4000   │───▶│ postgres:5432│
│  (Next.js)  │    │   (Hono)    │───▶│ redis:6379   │
└─────────────┘    └─────────────┘    └──────────────┘
                         │
                   ┌─────┴─────┐
                   │  worker   │
                   │ (BullMQ)  │
                   └───────────┘
```

- **web** — Next.js 前端（standalone 模式，无需 node_modules）
- **api** — Hono HTTP 服务，接收请求并入队研究任务
- **worker** — BullMQ Worker，消费队列执行研究流程（同一镜像，不同 CMD）
- **postgres** — 数据持久化
- **redis** — 任务队列 + 搜索缓存

---

## 二、Dockerfile 设计

### 2.1 apps/api（多阶段构建）

| 阶段 | 作用 | 关键操作 |
|------|------|---------|
| base | 基础镜像 | `node:22-alpine` + pnpm 9.15.0 |
| deps | 安装依赖 | 复制所有 `package.json` + lockfile → `pnpm install --frozen-lockfile` |
| build | 编译 | 复制源码 → `pnpm turbo build --filter=@contritas/api...`（含所有上游 packages）|
| production | 运行 | 仅复制 `dist/` + 生产依赖，`CMD node dist/index.js` |

同一镜像支持两种角色：
- API Server: `docker run <image>` （默认 CMD）
- Worker: `docker run <image> node dist/worker.js`

### 2.2 apps/web（Next.js standalone）

| 阶段 | 作用 | 关键操作 |
|------|------|---------|
| base | 基础镜像 | `node:22-alpine` + pnpm 9.15.0 |
| deps | 安装依赖 | 同上 |
| build | 构建 | `NEXT_PUBLIC_API_URL` 作为 ARG → `pnpm turbo build --filter=@contritas/web` |
| production | 运行 | 仅复制 `.next/standalone` + `.next/static` + `public`，`CMD node apps/web/server.js` |

> **注意**：`NEXT_PUBLIC_API_URL` 是构建时变量（Next.js 内联），需要在 build 时设置。

---

## 三、快速启动（生产模式）

### 3.1 前置条件

- Docker + Docker Compose v2
- 有效的 API Keys（Anthropic + Tavily）

### 3.2 启动命令

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，填入生产配置

# 2. 构建并启动所有服务
docker compose -f docker-compose.prod.yml up --build -d

# 3. 查看服务状态
docker compose -f docker-compose.prod.yml ps

# 4. 查看日志
docker compose -f docker-compose.prod.yml logs -f api worker

# 5. 停止服务
docker compose -f docker-compose.prod.yml down
```

### 3.3 仅构建镜像（用于 CI/CD 推送到 registry）

```bash
# 构建 API 镜像
docker build -f apps/api/Dockerfile -t contritas-api:latest .

# 构建 Web 镜像（指定 API 地址）
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com \
  -t contritas-web:latest .
```

---

## 四、环境变量参考

### 4.1 必需变量

| 变量 | 服务 | 说明 | 示例 |
|------|------|------|------|
| `DATABASE_URL` | api, worker | PostgreSQL 连接串 | `postgresql://postgres:pwd@postgres:5432/contritas` |
| `REDIS_URL` | api, worker | Redis 连接串 | `redis://redis:6379` |
| `LLM_PROVIDER` | api, worker | LLM 提供方 | `claude` 或 `openai-compatible` |
| `ANTHROPIC_API_KEY` | api, worker | Anthropic API Key（当 LLM_PROVIDER=claude） | `sk-ant-...` |
| `OPENAI_COMPATIBLE_API_KEY` + `OPENAI_COMPATIBLE_BASE_URL` | api, worker | OpenAI 兼容 endpoint | `sk-...` + `https://...` |
| `TAVILY_API_KEY` | api, worker | Tavily 搜索 Key | `tvly-...` |
| `API_AUTH_TOKEN` | api | Bearer Token 白名单（逗号分隔） — Phase 6.1 | `openssl rand -hex 32` |
| `WEB_ORIGIN` | api | CORS allowlist（生产必填） — Phase 6.1 | `https://app.example.com` |
| `NEXT_PUBLIC_API_URL` | web (构建时) | 前端打包进 JS bundle 的 API URL（必填，无默认；Dockerfile 直接 fail） | `https://api.example.com` |
| `NEXT_PUBLIC_API_TOKEN` | web (构建时) | 与 `API_AUTH_TOKEN` 之一一致（必填） — Phase 6.1 | 同上 |
| `POSTGRES_PASSWORD` | postgres | 数据库密码（fail-fast，无默认） | `openssl rand -hex 24` |

### 4.2 可选变量

| 变量 | 服务 | 说明 | 默认值 |
|------|------|------|--------|
| `PORT` | api | HTTP 端口 | `4000` |
| `ANTHROPIC_BASE_URL` | api, worker | 自定义 Anthropic 端点（非 `*.anthropic.com` 触发 warn 日志） | 官方 API |
| `OPENAI_COMPATIBLE_MODEL` | api, worker | 默认模型 ID | `gpt-4o` |
| `LLM_MODEL_CHEAP` | api, worker | Sprint C 两档路由的 cheap 档模型 id（用于 inputValidation/retrieval phase）；留空时所有 phase 都跑默认模型 | 与默认模型一致 |
| `SERPER_API_KEY` | api, worker | 备用搜索引擎 | 不启用 |
| `JINA_API_KEY` | api, worker | Jina Reader 内容提取 | 免费 tier |
| `FIRECRAWL_API_KEY` | api, worker | Firecrawl 内容提取 | 不启用 |
| `RATE_LIMIT_IP_PER_MIN` | api | IP 全局限流 | `60` |
| `RATE_LIMIT_CREATE_PER_HOUR` | api | 会话创建限流（IP+token） | `10` |
| `RUN_MIGRATIONS` | api, worker | api 容器启动是否自动跑 drizzle migrate；compose 内 worker 默认设 `false` 避免争锁 | api: `true` / worker: `false` |
| `SHUTDOWN_TIMEOUT_MS` | api | 优雅关闭兜底超时（ms） | `30000` |

### 4.3 docker-compose.prod.yml 中的变量传递

环境变量通过 shell 环境或 `.env` 文件传入 compose：

```bash
# 方式 1：使用 .env 文件（推荐）
echo "ANTHROPIC_API_KEY=sk-ant-xxx" >> .env
docker compose -f docker-compose.prod.yml up -d

# 方式 2：命令行传入
ANTHROPIC_API_KEY=sk-ant-xxx docker compose -f docker-compose.prod.yml up -d
```

---

## 五、健康检查与优雅关闭

### 5.1 健康检查端点

```
GET /health → 200 | 503
```

响应示例：

```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "timestamp": "2026-05-20T10:00:00.000Z"
}
```

- 同时检测 PostgreSQL（`SELECT 1`）和 Redis（`PING`）连通性
- 任一依赖异常返回 `503` + 具体错误信息，`status` 变为 `"degraded"`
- 用于 Docker 健康检查和负载均衡器探活

### 5.2 优雅关闭

| 服务 | 关闭行为 |
|------|---------|
| api | 收到 SIGTERM → 停止接收新请求 → 等待进行中请求完成 → 关闭 Redis/DB 连接 → 退出 |
| worker | 收到 SIGTERM → 停止拉取新 job → 等待当前 job 完成（最长 30 分钟锁超时）→ 关闭 Redis → 退出 |

Worker 的 `stop_grace_period` 在 compose 中设为 5 分钟，确保长时间运行的研究任务有足够时间完成。如果 job 超过 5 分钟仍未结束，Docker 会强制终止进程，BullMQ 会在 lock 过期后自动重试该 job。

---

## 六、CI/CD 集成提示

仓库内三个 workflow 各司其职：

| 文件 | 触发 | 做什么 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR + push to main | typecheck / test / build / Docker build smoke（不推镜像）|
| `.github/workflows/changeset-check.yml` | PR | 校验 PR 是否带 changeset，文档/CI 类用 `pnpm changeset --empty` 跳过 |
| `.github/workflows/changesets-release.yml` | push to main | 消费 `.changeset/*` → 开/更新一个 `chore: release` PR（bump 版本号），merge 后推 tag |
| `.github/workflows/release.yml` | tag `v*.*.*` | 多架构构建并推送 GHCR 镜像 + 创建 GitHub Release |

### 6.1 发布流程

1. 开 PR，commit 一个 changeset（`pnpm changeset`）。
2. PR merge 到 `main` → `Release PR` workflow 自动开/更新 `chore: release` PR，里面已经把 `package.json` 与 changesets 处理好。
3. Review 后 merge `chore: release` PR → `changesets/action` 推 git tag `v0.x.y` → `release.yml` 触发：
   - `docker/setup-qemu-action` + `setup-buildx-action` 构建 `linux/amd64,linux/arm64`。
   - login GHCR（用 `secrets.GITHUB_TOKEN`，权限 `packages: write` 由 workflow 顶层 `permissions:` 块声明）。
   - 推送两个镜像 + tag：`ghcr.io/xgyyx/contritas-api:<version>` / `ghcr.io/xgyyx/contritas-web:<version>` + `latest`。
   - `scripts/extract-changelog.mjs` 抽取 `CHANGELOG.md` 对应 `## [<version>]` 段落作为 GitHub Release notes。

### 6.2 一次性配置

发布前需要在仓库 Settings 配好：
- **Variables**：`RELEASE_NEXT_PUBLIC_API_URL`（构建 web 镜像时烤进 JS bundle 的 API URL；先填占位 `https://api.example.com`，部署方在 deploy 端可覆盖容器 env 但 fetch 路径不变）。
- **Secrets**：`RELEASE_NEXT_PUBLIC_API_TOKEN`（同样 build-time 注入；多租户场景应改为 deploy-time runtime 注入）。
- **Actions → Workflow permissions**：开启 `Read and write`。
- 第一次 push 镜像后，到 `Packages` 把 `contritas-api` / `contritas-web` 可见性设为 `Public`（如需公开拉取）。

### 6.3 数据库迁移

API 容器启动时 `docker-entrypoint.sh` 自动执行 `node dist/scripts/migrate.js`，应用 `src/drizzle/migrations/` 下未执行的迁移；完成后才 exec CMD（`node dist/index.js`）。

- 迁移文件由开发者在本地 `pnpm db:generate` 后随源码一起 commit。
- worker 服务通过 `RUN_MIGRATIONS=false` 跳过迁移（避免与 api 同时争 advisory lock）；compose 中 worker 的 `depends_on.api: service_healthy` 保证 api 已迁移后再启动 worker。
- K8s 等多副本环境：建议把迁移拆成独立 Job 跑（同样调用 `node dist/scripts/migrate.js`），所有 api/worker 副本均设 `RUN_MIGRATIONS=false`。
- 紧急回滚：手动 `psql` 还原；drizzle-kit 暂不支持 down migration。

### 6.4 使用 GHCR 预构建镜像

发布后两个镜像同时打 `<version>` 与 `latest` tag，覆盖 `linux/amd64` + `linux/arm64`：

```bash
docker pull ghcr.io/xgyyx/contritas-api:0.6.0
docker pull ghcr.io/xgyyx/contritas-web:0.6.0
```

**Tag 策略**：

| Tag | 含义 | 用途 |
| --- | --- | --- |
| `<version>`（如 `0.6.0`） | 不可变 immutable，对应一次 release | 生产部署用版本锁定 |
| `latest` | 最新一次 release | 仅用于本地试用，**不要**在生产环境使用 |

**自带 docker compose 切到 GHCR 镜像**：把 `docker-compose.prod.yml` 中 api / worker / web 的 `build` 块替换为 `image: ghcr.io/xgyyx/contritas-api:0.6.0` 即可。worker 同样用 api 镜像（`image: ghcr.io/xgyyx/contritas-api:0.6.0`，覆盖 `command: ["node", "dist/worker.js"]`）。

**web 镜像注意**：`NEXT_PUBLIC_API_URL` 烤进 JS bundle，意味着同一镜像无法切换后端域名。如果你的部署目标 API 地址与发布时配置的不同，需要在自己的环境里 rebuild web 镜像（或通过反代把后端代理到镜像构建时的 URL）。

---

## 七、常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| `pnpm install` 报 lockfile 不匹配 | 本地 pnpm 版本与镜像不一致 | 确保本地也使用 pnpm 9.15.0（`corepack enable`）|
| Web 页面 API 请求 404 | `NEXT_PUBLIC_API_URL` 构建时未设置正确 | 重新 build web 镜像并传入正确的 ARG |
| Worker 被强制终止、job 丢失 | `stop_grace_period` 不足 | 增大 grace period 或拆分超长 job |
| health 返回 503 | DB 或 Redis 未就绪 | 检查 `depends_on` + `service_healthy` 条件；检查网络连通 |
| 镜像体积过大 | 包含了开发依赖 | 确认 production stage 使用 `--prod` 安装 |

---

## 八、低成本部署方案

针对 0 / 极低基础设施成本场景（早期项目、个人 / 私有部署），仓库内提供一套现成的部署目录：

- **`deploy/oracle-free-tier/`** — Oracle Cloud Always Free ARM 单机部署，5 个服务全跑一台 + Caddy 自动 TLS + Object Storage 备份；基础设施 **~$1/月**（仅域名）。
- 完整步骤、Oracle 特有坑（iptables、Reserve IP、空闲回收）见 [oracle-free-tier.md](./oracle-free-tier.md)。

换平台（Hetzner / 阿里轻量 / 自有 VPS）时大部分配置可复用，把 compose 里的 `platform: linux/arm64` 去掉即可。

---

## 九、镜像体积优化

| 措施 | 效果 |
|------|------|
| `node:22-alpine` 基础镜像 | ~120MB vs ~1GB (debian) |
| 多阶段构建，仅复制产物 | 排除源码、devDependencies |
| `.dockerignore` 排除 node_modules/.git | 减小构建上下文传输 |
| Next.js `output: "standalone"` | 仅包含运行时必需文件（~30MB） |
| 生产依赖 `--prod` 安装 | 排除 typescript/vitest 等 |
