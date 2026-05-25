# 实时通信与基础设施

> SSE 进度推送、存储方案、部署架构、安全运维。
>
> 相关文档：[架构总览](./overview.md)

---

## 一、实时通信：SSE + Redis PubSub

### 1.1 为什么 SSE 而非 WebSocket

| 因素       | SSE                          | WebSocket                 |
| ---------- | ---------------------------- | ------------------------- |
| 方向       | 单向（服务端→客户端）        | 双向                      |
| 我们的需求 | 进度推送仅需 server→client   | 用户操作走 REST           |
| 基础设施   | CDN/LB 无需特殊配置          | 需要 sticky session       |
| 重连       | 内置自动重连 + Last-Event-ID | 需手动实现                |

### 1.2 事件类型

前端通过 SSE 订阅 `GET /api/research/{id}/stream`，接收以下结构化事件：

| 事件类型           | 说明                                   |
| ------------------ | -------------------------------------- |
| `phase_change`     | Phase 状态变化（started / completed）  |
| `dimension_update` | 维度检索进度（来源数、当前轮次）       |
| `search_executed`  | 搜索执行（关键词、语言、结果数）       |
| `evidence_added`   | 新证据加入（维度、来源、可信度）       |
| `error`            | 错误事件（是否可恢复）                 |
| `eta_update`       | 预估剩余时间更新                       |
| `report_ready`     | 报告生成完成                           |

### 1.3 实现要点

- **服务端**：Hono `streamSSE` + Redis PubSub 订阅，先发送 catchup 事件（历史），再订阅实时流
- **客户端**：React Hook `useResearchStream`，使用 Zustand 累积事件构建完整进度视图
- **断线重连**：浏览器原生 EventSource 自动重连，但跨域 + 自定义 query 场景下不会自动 fan-out `Last-Event-ID` header；客户端 `apps/web/src/lib/sse-client.ts` 因此手动维护 `lastEventId`，重连时通过 `URLSearchParams` 拼入 `?lastEventId=` query；服务端 `getEventHistory` 同时支持 `Last-Event-ID` header 与 `?lastEventId=` query，做 `XRANGE ${lastId} +` 增量回放（6.4.6 服务端 + 6.4.8 客户端）
- **心跳保活**：30 秒间隔

### 1.4 事件持久化

所有事件写入 Redis Stream（`XADD`），按 sessionId 分 key：
- 断线重连时通过 `XRANGE` 补发
- 7 天后自动过期（Redis TTL）

---

## 二、存储方案

### 2.1 PostgreSQL — 主数据

| 存什么                       | 为什么                                  |
| ---------------------------- | --------------------------------------- |
| 会话、假设、维度、证据、报告 | 关系型数据、需要事务、需要持久          |
| JSONB 字段                   | 灵活 schema（phases、keywords、config） |
| 全文搜索                     | 搜索历史报告                            |

推荐服务：Neon（Serverless PostgreSQL）或 Supabase。ORM 使用 Drizzle。

### 2.2 Redis — 队列 / 缓存 / PubSub

| 用途        | 说明                                          |
| ----------- | --------------------------------------------- |
| BullMQ 队列 | 研究作业调度、进度追踪、重试                  |
| PubSub      | SSE 事件分发（Worker → API Server）           |
| Streams     | 事件历史（用于 SSE catchup）                  |
| Cache       | LLM 响应缓存（7 天）、搜索结果缓存（24 小时） |

推荐服务：Upstash（Serverless Redis）或 Railway 自带 Redis。

### 2.3 对象存储（可选）— Cloudflare R2

| 存什么             | 为什么               |
| ------------------ | -------------------- |
| 提取的完整页面内容 | 可能很大，不放数据库 |
| 导出的 PDF 报告    | 静态文件             |
| 证据存档截图       | 审计追溯             |

---

## 三、部署方案

### 3.1 本地开发

`docker-compose.yml` 启动基础设施（PostgreSQL + Redis），应用通过 `pnpm dev` 本地运行：

```yaml
services:
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: contritas
      POSTGRES_PASSWORD: dev

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

### 3.2 生产部署

| 服务            | 平台              | 理由                            |
| --------------- | ----------------- | ------------------------------- |
| 前端 (Next.js)  | Vercel            | 针对 Next.js 优化、CDN 全球分发 |
| 后端 (Hono)     | Railway           | 支持长时运行 Worker、简单部署   |
| Worker (BullMQ) | Railway           | 与 API 同部署平台、共享数据库   |
| PostgreSQL      | Railway / Neon    | Managed、自动备份               |
| Redis           | Railway / Upstash | Managed、持久化                 |

**为什么不用 Serverless**：研究会话运行 10-60 分钟，Serverless 有执行时间限制（通常 10s-300s），Worker 需要持久连接。

### 3.3 CI/CD

```
push to main → lint + typecheck + test → build → deploy
push to PR   → lint + typecheck + test → preview deploy
```

工具：GitHub Actions

---

## 四、安全性与运维

### 4.1 认证与授权（Phase 6.1 已落地）

当前为**单租户 Bearer Token** 模型，定位"内部工具 / 私有部署"：

- 所有 `/api/research/*` 端点强制 `Authorization: Bearer <token>`；token 不在 `API_AUTH_TOKEN` 白名单 → `401`。
- 每个 `research_sessions` 行写入 `owner_token_hash`；非 owner 访问 → `404`（不暴露存在性）。
- SSE 端点同样校验：浏览器 EventSource 通过 `?token=` 查询参数传递；服务端取出后立即丢弃，避免日志泄漏。
- 多用户 / OIDC / 自动轮换等高级方案不在 Phase 6 范围。

实现：`apps/api/src/middleware/auth.ts`、`apps/api/src/routes/research.ts`。
策略详情：[docs/security.md](../security.md)。

### 4.2 输入限制与频率控制（Phase 6.1 已落地）

| 限制项                       | 阈值                          | 配置 env                        |
| ---------------------------- | ----------------------------- | ------------------------------- |
| `proposition` 长度           | 10–2000 字符 + 控制字符过滤   | 硬编码                          |
| `userResponse` 长度          | 1–2000 字符 + 控制字符过滤    | 硬编码                          |
| `iterate.details` 长度       | ≤ 1000 字符                   | 硬编码                          |
| IP 全局请求限流              | 60 req/min                    | `RATE_LIMIT_IP_PER_MIN`         |
| 会话创建（IP+token）         | 10 req/h                      | `RATE_LIMIT_CREATE_PER_HOUR`    |
| 单会话搜索调用上限           | 150                           | 见 §4.3                         |
| SSE 连接数（per 用户）       | 暂未限制                      | 后续考虑                        |

实现：`apps/api/src/middleware/rate-limit.ts`、`packages/shared/src/utils/validation.ts`。

### 4.3 成本保护

- **Token 预算**：低 50K / 中 150K / 高 300K，超过预算进入降级模式
- **搜索调用上限**：150 次/会话
- **成本仪表盘**：记录每次 LLM 调用的 `estimatedCostUSD`，按会话汇总

### 4.4 数据生命周期

| 数据                   | 保留策略                             |
| ---------------------- | ------------------------------------ |
| 已完成的研究会话       | 90 天（soft delete → 30 天后硬删除） |
| 失败/取消的会话        | 7 天硬删除                           |
| Redis 事件流           | 7 天 TTL                             |
| BullMQ 已完成作业      | 7 天                                 |
| 搜索结果缓存           | 24 小时 TTL                          |
| LLM 响应缓存           | 7 天 TTL                             |

### 4.5 CORS（Phase 6.1 已落地）

- 仅允许 `WEB_ORIGIN`（逗号分隔 allowlist）中的 origin；其他 origin 不返回 ACAO 头。
- `credentials: false`（鉴权走 Authorization 头，不用 cookie）。
- 生产环境若未配置 `WEB_ORIGIN`，启动失败（dev 默认 `http://localhost:3000`）。

### 4.6 内容安全（Phase 6.1 已落地）

- **SSRF**：抓取 URL（Jina / Firecrawl / Wayback）调用前过 `assertSafePublicUrl`，拒绝非 `http(s)`、私网 IP、云元数据地址。
- **Prompt Injection**：所有外部 / 用户文本以 `<external_content>` 围栏 + system prompt 安全条款进入 LLM。
- **`ANTHROPIC_BASE_URL`**：非 `*.anthropic.com` 域名启动时打印 warn 日志，便于审计。

完整策略：[docs/security.md](../security.md)。
