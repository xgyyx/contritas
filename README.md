<div align="center">

# Contritas

### 不证明你是对的，证明你经得起尽调。

**通过反证逼近真相的深度研究 Agent**——把你的判断当假设，而不是当结论。

[![CI](https://github.com/xgyyx/contritas/actions/workflows/ci.yml/badge.svg)](https://github.com/xgyyx/contritas/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-22%2B-339933?logo=node.js&logoColor=white)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](#)
[![Status](https://img.shields.io/badge/status-Phase%206%20%E5%8A%A0%E5%9B%BA%E4%B8%AD-orange)](./docs/progress/roadmap.md)

[**📖 技术博客**](./docs/blog/01-architecture-and-stack.md) ·
[**🏗️ 架构文档**](./docs/architecture/overview.md) ·
[**📋 PRD**](./docs/prd/prd.md) ·
[**🚀 快速开始**](#-快速开始)

</div>

---

## 🤔 为什么需要 Contritas？

> 你用 Perplexity 问"我用 Rust 重写核心服务值得吗"，它会告诉你 Rust 性能有多强、生态有多好。
>
> 你最该听到的是：**这个判断里最脆弱的假设是什么、谁的论证最薄、哪些证据互相矛盾。**

主流 AI 调研工具都是**搜索增强问答**——你问什么它答什么，倾向于支持你。专业尽职调查的口径恰恰相反：**审计**，不是鼓励。

Contritas 的差异不是"能力"，是**承诺**：

- ⚖️ **审计口径，非鼓励口径** —— 不迎合用户预期，主动找反证
- 🔍 **反证优先** —— 每个假设先问"如果它不成立，会因为什么"
- 🧪 **交叉验证作为硬约束** —— 同一假设若证据方向矛盾，必须标注，不许挑顺耳的写
- 📊 **证据分级 + 置信度** —— 高/中/弱来源区分，每条结论可追溯到证据编号
- 🚫 **零幻觉断言** —— 报告里不允许出现无来源支撑的判断

**目标用户**：独立创业者、小团队负责人、早期投资人——面临真实决策风险，但请不起专业尽调团队的人。

---

## ✨ 核心能力

| | |
|---|---|
| 🧠 **假设拆解** | 输入决策命题 → 拆出 3-8 个核心假设，按"如果不成立影响多大"排序 |
| 🌐 **多源检索** | Tavily / Serper 双引擎，Jina Reader / Firecrawl 多级降级抓取页面正文 |
| 🔁 **多轮迭代** | 单维度最多 5 轮检索，证据不足时自动调整关键词补充 |
| ⚖️ **交叉验证** | 同假设多源比对，矛盾必须标注口径差异、来源偏见、时间错位 |
| 📈 **置信度评分** | 总分 + 各维度评级（✅支持 / ⚠️存疑 / ❌不支持），并解释"为什么不更高/不更低" |
| 🎯 **行动建议** | 推进 / 暂缓 / 否定 / 修正——每条建议含执行主体、时间框架、验证标准 |
| 📊 **实时进度** | SSE 推送 6 个 Phase 实时状态、ETA、来源累积、维度细节 |
| 🔄 **报告迭代** | 不满意？指定深挖维度或新增维度，增量更新而非重做 |

---

## 🎬 看一眼它怎么干活

```
用户输入：「2026 下半年美联储降息这个判断靠谱吗？」

Phase 0  ✓ 命题足够具体，进入研究
Phase 1  ✓ 拆解出 5 个核心假设：
           [高] 通胀回落到 2% 目标区间
           [高] 就业市场出现实质降温
           [中] 联储声明偏鸽派
           [中] 历史降息周期可类比
           [低] 市场已 price-in
Phase 2  ✓ 为每个假设规划维度 + 中英双语关键词
Phase 3  ⏳ [████░░░░] 多维度并行检索，已收集 27 条证据
Phase 4  ✓ 交叉验证：发现 2 处证据矛盾（CPI 口径差异、就业数据修正前后）
Phase 5  ✓ 综合报告 → 自检通过 → 输出

→ 总体结论：⚠️ 存疑（置信度 6.2/10）
→ 最脆弱假设：就业实质降温——非农数据有明显下修历史
→ 行动建议：决策前等待 9 月 PCE + 8 月非农修正版
```

---

## 🛠️ 技术栈

> 想看每个选型背后的纠结？读 [《我做了一个会跟你唱反调的 AI 尽调 Agent》](./docs/blog/01-architecture-and-stack.md)。

<table>
<tr><td>

**前端**
- Next.js 14 (App Router)
- shadcn/ui + Tailwind CSS
- Zustand · react-markdown

**后端 / API**
- Hono on Node 22
- Server-Sent Events (SSE)
- Zod 全链路校验

</td><td>

**编排 / 任务**
- XState v5（6-Phase 状态机）
- BullMQ + Redis（长任务队列）
- 断点续做 / 序列化恢复

**LLM 抽象层**
- Claude（深度推理）
- OpenAI Compatible（DeepSeek/litellm/...）
- Model Router 按 Phase 路由 + Token 预算

</td><td>

**搜索层**
- Tavily（主） / Serper（备）
- Jina Reader → Firecrawl → Web Archive
- 24h 搜索缓存 + 7 天 LLM 缓存

**存储 / 部署**
- PostgreSQL + Drizzle ORM
- Redis Streams（事件持久化）
- Docker Compose（开发 + 生产）

</td></tr>
</table>

---

## 🧱 项目结构

pnpm monorepo，4 个 package + 2 个 app：

```
apps/
  api/          Hono HTTP 服务 + BullMQ Worker
  web/          Next.js 14 前端
packages/
  shared/       共享类型、Zod schema、工具函数
  llm/          LLM Provider 抽象层 + Model Router + Prompts
  search/       搜索/提取 Provider + 编排器 + 缓存
  workflow/     XState v5 研究流程状态机
```

依赖：`shared` ← `llm` ← `search` ← `workflow`，`api` 依赖全部四个。

---

## 🚀 快速开始

**前置**：Node.js ≥ 22 · pnpm ≥ 9 · Docker

```bash
# 1. 安装依赖
pnpm install

# 2. 启动基础设施（PostgreSQL + Redis）
docker compose up -d

# 3. 配置环境变量
cp .env.example .env
# 至少需要 ANTHROPIC_API_KEY 和 TAVILY_API_KEY

# 4. 推送数据库 schema
cd apps/api && pnpm db:push

# 5. 三个终端分别启动
cd apps/web && pnpm dev          # 前端 :3000
cd apps/api && pnpm dev          # API :4000
cd apps/api && pnpm worker       # Worker
```

打开 <http://localhost:3000> 开始用。

### 生产模式（Docker 一键起）

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

详见 [Docker 部署指南](./docs/deployment/docker.md)。

### 常用命令

```bash
pnpm turbo test          # 全量测试
pnpm turbo typecheck     # 类型检查
cd apps/api && pnpm db:generate   # 生成迁移
```

---

## 🔬 研究流程（6-Phase Pipeline）

```
Phase 0  输入验证   →  命题足够具体？模糊就追问
Phase 1  假设拆解   →  3-8 个核心假设 + 重要性排序
Phase 2  研究规划   →  维度 + 中英双语关键词 + 目标来源类型
Phase 3  多源检索   →  并行检索 + 多轮迭代 + 页面提取
Phase 4  交叉验证   →  证据矛盾标注 + 定量 sanity check
Phase 5  报告综合   →  评分 + 行动建议 + 自检（不通过回退 Phase 3）
```

状态机定义：[`packages/workflow/src/machine.ts`](./packages/workflow/src/machine.ts) ·
设计文档：[工作流引擎](./docs/architecture/workflow-engine.md)

---

## 🗺️ 进度

- [x] **Phase 1** 核心骨架（Monorepo + DB + LLM + Workflow + API）
- [x] **Phase 2** 搜索能力（Tavily + Jina + Search Orchestrator）
- [x] **Phase 3** 完整研究流程（交叉验证 + 报告综合 + 评分 + 自检）
- [x] **Phase 4** Web 前端（Next.js + SSE + 报告查看 + 迭代交互）
- [x] **Phase 5** 优化与扩展（Model Router + Token 预算 + 缓存优化 + ETA 事件）
- [ ] **Phase 6** 生产加固（安全 / 数据一致性 / Worker 稳定性 / SSE 可靠性 / 可观测性 / 测试覆盖 / 容器化 / DX / 文档同步）—— 进行中

完整路线：[`docs/progress/roadmap.md`](./docs/progress/roadmap.md)

---

## 📚 文档

### 想读懂产品

- 📖 [《我做了一个会跟你唱反调的 AI 尽调 Agent》](./docs/blog/01-architecture-and-stack.md) — 架构与选型背后的思考
- 🪞 [《怎么让 LLM 跟你唱反调》](./docs/blog/02-anti-flattery-prompt-design.md) — 反讨好式 Prompt 工程
- 🔍 [《Phase 4 交叉验证：让 LLM 找证据矛盾》](./docs/blog/03-phase4-cross-validation.md) — 把"看看证据"变成结构化工程问题
- 📚 [博客全集与待写选题](./docs/blog/) — 完整文章索引与 backlog
- 📋 [PRD](./docs/prd/prd.md) — 定位、用户故事、功能列表、非功能需求
- 📄 [报告模板](./docs/prd/report-template.md) — 输出报告的标准格式
- 🤖 [Agent 行为规范](./docs/guides/agent-behavior.md) — 评分、降级、交互、约束规则

### 想读懂工程

- 🏗️ [架构总览](./docs/architecture/overview.md) — 系统全貌、选型决策、风险应对
- 🔄 [工作流引擎](./docs/architecture/workflow-engine.md) — XState 状态机、重试、持久化
- 🧠 [LLM 层](./docs/architecture/llm-layer.md) — Provider 抽象、Model Router
- 🔍 [搜索层](./docs/architecture/search-layer.md) — 搜索/提取 Provider、编排器
- 💾 [数据模型](./docs/architecture/data-model.md) — PostgreSQL Schema、实体关系
- 📡 [实时与基础设施](./docs/architecture/realtime-and-infra.md) — SSE、存储、部署
- 🐳 [Docker 部署](./docs/deployment/docker.md) — 容器化构建与运维
- 🔒 [安全策略](./docs/security.md) — 鉴权 / CORS / 限流 / SSRF / Prompt Injection
- 🔗 [PRD 映射表](./docs/prd-mapping.md) — PRD 需求 → 技术实现追踪

---

## 🤝 贡献

欢迎 Issue / PR。约定见 [CONTRIBUTING](./CONTRIBUTING.md)。

## 📜 命名

> **Contritas** = _Contra_（反向）+ _Veritas_（真理） —— **通过反证逼近真相**
>
> 拉丁语 _contritus_ 另义："碾碎" —— 把假设碾碎检验
>
> Slogan: **_Grind assumptions. Surface truth._**

## 📄 License

[MIT](./LICENSE)
