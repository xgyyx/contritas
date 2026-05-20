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
| `NEXT_PUBLIC_API_TOKEN` | web (构建时) | 与 `API_AUTH_TOKEN` 之一一致 — Phase 6.1 | 同上 |
| `POSTGRES_PASSWORD` | postgres | 数据库密码（**生产必填，禁用默认值**） | `openssl rand -hex 24` |

### 4.2 可选变量

| 变量 | 服务 | 说明 | 默认值 |
|------|------|------|--------|
| `PORT` | api | HTTP 端口 | `4000` |
| `ANTHROPIC_BASE_URL` | api, worker | 自定义 Anthropic 端点（非 `*.anthropic.com` 触发 warn 日志） | 官方 API |
| `OPENAI_COMPATIBLE_MODEL` | api, worker | 默认模型 ID | `gpt-4o` |
| `SERPER_API_KEY` | api, worker | 备用搜索引擎 | 不启用 |
| `JINA_API_KEY` | api, worker | Jina Reader 内容提取 | 免费 tier |
| `FIRECRAWL_API_KEY` | api, worker | Firecrawl 内容提取 | 不启用 |
| `RATE_LIMIT_IP_PER_MIN` | api | IP 全局限流 | `60` |
| `RATE_LIMIT_CREATE_PER_HOUR` | api | 会话创建限流（IP+token） | `10` |
| `NEXT_PUBLIC_API_URL` | web (构建时) | 前端连接的 API 地址 | `http://localhost:4000` |

> ⚠️ **`POSTGRES_PASSWORD` 当前在 `docker-compose.prod.yml` 仍有 `prod_secret` 默认值**，将在 Phase 6.8.4 改为 fail-fast。生产部署**务必**显式设置。

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

仓库内已有的 `.github/workflows/ci.yml` 只做**验证**（typecheck + test + build + Docker build smoke，不推镜像），用于守住 PR 质量。生产部署需要把镜像**推送到 registry**，那是另一个工作流——下面是参考示例，可以与 `ci.yml` 共存。

### 6.1 GitHub Actions 示例（构建并推送镜像到 registry）

```yaml
# .github/workflows/docker.yml — 与 ci.yml 互补：仅在 push 到 main 时构建并推到 GHCR
name: Build & Push
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: apps/api/Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository }}/api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: apps/web/Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository }}/web:${{ github.sha }}
          build-args: NEXT_PUBLIC_API_URL=${{ vars.API_URL }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### 6.2 数据库迁移

生产环境推送 schema 变更：

```bash
# 在 API 容器中执行（需要 drizzle-kit 作为 devDependency）
docker compose -f docker-compose.prod.yml exec api \
  npx drizzle-kit push
```

或在 CI/CD 中作为部署步骤单独运行。

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

## 八、镜像体积优化

| 措施 | 效果 |
|------|------|
| `node:22-alpine` 基础镜像 | ~120MB vs ~1GB (debian) |
| 多阶段构建，仅复制产物 | 排除源码、devDependencies |
| `.dockerignore` 排除 node_modules/.git | 减小构建上下文传输 |
| Next.js `output: "standalone"` | 仅包含运行时必需文件（~30MB） |
| 生产依赖 `--prod` 安装 | 排除 typescript/vitest 等 |
