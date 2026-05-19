# Contritas — 技术方案文档

> 基于 PRD v1 设计的全栈 Web 应用技术方案。

---

## 一、系统架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │            Next.js 14 (App Router + React)                         │  │
│  │  ┌──────────┐ ┌──────────────┐ ┌───────────┐ ┌────────────────┐ │  │
│  │  │ 输入页面  │ │  研究进度面板  │ │ 报告查看器 │ │  历史 / 设置   │ │  │
│  │  └──────────┘ └──────────────┘ └───────────┘ └────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ REST + SSE
┌────────────────────────────────┴────────────────────────────────────────┐
│                            API LAYER                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │              Hono HTTP Server (TypeScript)                          │  │
│  │  ┌────────────┐  ┌───────────────┐  ┌─────────────────────────┐  │  │
│  │  │ REST Routes │  │  SSE Endpoint  │  │  Session Management    │  │  │
│  │  └────────────┘  └───────────────┘  └─────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────┴────────────────────────────────────────┐
│                       ORCHESTRATION LAYER                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │          Agent Workflow Engine (XState v5 State Machine)            │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌─────┐│  │
│  │  │Phase 0 │→│Phase 1 │→│Phase 2 │→│Phase 3 │→│Phase 4 │→│Ph 5 ││  │
│  │  │验证输入 │ │拆解假设 │ │制定计划 │ │多源检索 │ │交叉验证 │ │综合  ││  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └─────┘│  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────┬────────────────────────────────────┬─────────────────────────┘
           │                                    │
┌──────────┴──────────┐            ┌────────────┴──────────────────────────┐
│  LLM ABSTRACTION    │            │        SEARCH & RETRIEVAL LAYER        │
│ ┌─────────────────┐ │            │  ┌────────────┐  ┌─────────────────┐  │
│ │  Adapter Layer  │ │            │  │ Web Search │  │ Content Extractor│  │
│ │  ┌───────────┐  │ │            │  │ (Tavily)   │  │ (Jina Reader)   │  │
│ │  │  Claude   │  │ │            │  │ (Serper)   │  │ (Firecrawl)     │  │
│ │  │  OpenAI   │  │ │            │  └────────────┘  └─────────────────┘  │
│ │  │  DeepSeek │  │ │            └───────────────────────────────────────┘
│ │  │  Gemini   │  │ │
│ │  └───────────┘  │ │            ┌───────────────────────────────────────┐
│ └─────────────────┘ │            │           STORAGE LAYER                │
└─────────────────────┘            │  ┌────────────┐  ┌─────────────────┐  │
                                   │  │ PostgreSQL │  │ Redis (Queue +  │  │
                                   │  │ (Primary)  │  │ Cache + PubSub) │  │
                                   │  └────────────┘  └─────────────────┘  │
                                   └───────────────────────────────────────┘
```

### 核心架构决策

| 决策       | 选择                     | 理由                                                              |
| ---------- | ------------------------ | ----------------------------------------------------------------- |
| 通信方式   | SSE（非 WebSocket）      | 进度推送是单向的（服务端→客户端），SSE 更简单、自动重连、CDN 友好 |
| 任务模式   | 后台作业（非请求内执行） | 研究耗时 10-60 分钟，不能绑定在 HTTP 请求生命周期内               |
| 工作流引擎 | 状态机（XState）         | 支持并行状态、条件转换、序列化/恢复、可审计                       |
| 代码组织   | Monorepo                 | 前后端共享类型，避免接口漂移                                      |

---

## 二、前端方案

### 2.1 技术选型

| 项            | 选择                        | 理由                                         |
| ------------- | --------------------------- | -------------------------------------------- |
| 框架          | Next.js 14+ (App Router)    | Server Components 首屏快、路由内置、部署成熟 |
| UI 组件       | shadcn/ui + Tailwind CSS    | 可定制、无运行时开销、Accessibility 内置     |
| 状态管理      | Zustand                     | 轻量、TypeScript 原生、无 boilerplate        |
| Markdown 渲染 | react-markdown + remark-gfm | 支持表格、代码块、GFM 语法                   |

### 2.2 页面结构

| 路由             | 用途                               |
| ---------------- | ---------------------------------- |
| `/`              | 首页 — 输入研究命题                |
| `/research/[id]` | 研究进行中 — 实时进度面板          |
| `/report/[id]`   | 报告查看 — 完整报告渲染 + 目录导航 |
| `/history`       | 历史研究列表                       |
| `/settings`      | LLM/搜索 Provider 配置             |

### 2.3 关键组件

```
components/
├── research-input/
│   ├── PropositionForm.tsx         # 研究命题输入表单
│   ├── ClarificationDialog.tsx     # 多轮追问对话（Phase 0）
│   └── ComplexityIndicator.tsx     # 复杂度预估展示
├── progress/
│   ├── PhaseTimeline.tsx           # Phase 0-5 时间线
│   ├── DimensionProgress.tsx       # 各维度来源数进度
│   ├── LiveSearchFeed.tsx          # 实时搜索关键词流
│   └── EstimatedTime.tsx           # 预估剩余时间
├── report/
│   ├── ReportRenderer.tsx          # Markdown → React 渲染
│   ├── TableOfContents.tsx         # 侧边栏目录导航
│   ├── ScoreGauge.tsx              # 评分可视化
│   ├── EvidenceCard.tsx            # 证据卡片（含可信度标签）
│   └── IterationPanel.tsx          # 深挖/追加维度入口
└── shared/
    ├── StreamingText.tsx           # 流式文本展示
    └── MarkdownViewer.tsx          # 通用 Markdown 渲染器
```

### 2.4 实时进度展示

前端通过 SSE 订阅 `GET /api/research/{id}/stream`，接收结构化事件：

```typescript
type ProgressEvent =
  | { type: "phase_change"; phase: PhaseId; status: "started" | "completed" }
  | { type: "dimension_update"; dimensionId: string; sourcesFound: number; round: number }
  | { type: "search_executed"; query: string; language: "zh" | "en"; resultsCount: number }
  | { type: "evidence_added"; dimensionId: string; source: string; credibility: "high" | "medium" | "low" }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "eta_update"; estimatedSecondsRemaining: number }
  | { type: "report_ready"; reportId: string };
```

使用 Zustand 累积事件构建完整进度视图。断线重连时通过 `Last-Event-ID` 头实现事件补发（catchup）。

---

## 三、后端方案

### 3.1 技术选型

| 项        | 选择        | 理由                                                         |
| --------- | ----------- | ------------------------------------------------------------ |
| HTTP 框架 | Hono        | TypeScript-first、内置 SSE 支持、3x 快于 Express、跨 Runtime |
| 运行时    | Node.js 20+ | 生态最成熟，后续可迁移 Bun                                   |
| 任务队列  | BullMQ      | 可靠的长时任务、进度追踪、重试、子任务                       |
| ORM       | Drizzle     | 零开销 SQL 生成、TS 推断、原生 JSONB/Array 支持              |
| 校验      | Zod         | 前后端共享 Schema                                            |

### 3.2 API 设计

```
POST   /api/research                    # 创建研究会话（返回 202 + sessionId）
GET    /api/research/:id                # 获取会话状态
GET    /api/research/:id/stream         # SSE 实时进度流
POST   /api/research/:id/respond        # 用户回复追问（Phase 0）
POST   /api/research/:id/iterate        # 请求迭代（深挖/追加维度）
GET    /api/research/:id/report         # 获取最终报告
GET    /api/research/:id/evidence       # 获取所有证据
DELETE /api/research/:id                # 取消进行中的研究

GET    /api/history                     # 历史列表（分页）
PUT    /api/settings/llm                # 配置 LLM Provider
PUT    /api/settings/search             # 配置搜索 Provider
```

### 3.3 请求流转

```
用户提交命题 → POST /api/research → 创建 Session → 入队 BullMQ Job → 返回 202
                                                        │
                                                        ▼
                                                  BullMQ Worker
                                                        │
                                                 Workflow Engine
                                                   (XState)
                                                        │ emit events
                                                        ▼
                                                  Redis PubSub
                                                        │
                                                  SSE Handler → 前端
```

### 3.4 BullMQ 作业设计

```typescript
// 主研究作业
interface ResearchJob {
  sessionId: string;
  resumeFromPhase?: PhaseId; // 支持断点续做
}

// 维度检索子作业（Phase 3 并行）
interface DimensionSearchJob {
  sessionId: string;
  dimensionId: string;
  keywords: { zh: string[]; en: string[] };
  round: number;
}
```

配置：

- `attempts: 3` — 失败重试 3 次
- `backoff: { type: 'exponential', delay: 5000 }` — 指数退避
- `removeOnComplete: { age: 7 * 24 * 3600 }` — 7 天后清理

---

## 四、LLM 抽象层

### 4.1 设计理念

使用 **Adapter 模式** + **Model Router**，不同 Phase 可路由到不同模型：

- 推理密集型 Phase（1、4、5）→ 强模型（Claude Opus / GPT-4o）
- 高频提取型 Phase（3）→ 性价比模型（DeepSeek / GPT-4o-mini）

### 4.2 Provider 接口

```typescript
export interface LLMProvider {
  readonly name: string;
  readonly models: ModelInfo[];

  chat(params: ChatParams): Promise<ChatResponse>;
  chatStream(params: ChatParams): AsyncIterable<ChatChunk>;
  structuredOutput<T>(params: StructuredParams<T>): Promise<T>;
}

export interface ChatParams {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
  usage: TokenUsage;
  finishReason: "stop" | "length" | "tool_use";
}

export interface StructuredParams<T> {
  model: string;
  messages: Message[];
  schema: z.ZodSchema<T>; // Zod schema 校验输出结构
  systemPrompt?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
}
```

### 4.3 Provider 实现

| Provider            | SDK                 | 状态   | 用途                                          |
| ------------------- | ------------------- | ------ | --------------------------------------------- |
| Claude              | `@anthropic-ai/sdk` | ✅ 已实现 | 深度推理（Phase 1/4/5）、结构化输出；支持自定义 baseURL |
| OpenAI Compatible   | `openai`            | ✅ 已实现 | 兼容 OpenAI 格式的任意端点（one-api/litellm/ollama/vLLM/DeepSeek） |
| Mock                | 内置                | ✅ 已实现 | 测试用途                                      |

**配置方式（环境变量）：**

```bash
# 方式 A：Anthropic 官方或 Anthropic 协议代理
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_BASE_URL=https://your-proxy.com   # 可选，留空走官方

# 方式 B：OpenAI Compatible 端点
LLM_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_API_KEY=sk-xxx
OPENAI_COMPATIBLE_BASE_URL=https://your-proxy.com/v1
OPENAI_COMPATIBLE_MODEL=gpt-4o
```

### 4.4 Model Router

```typescript
export interface ModelRoutingConfig {
  inputValidation: ModelRef; // 需要判断力 → Claude/GPT-4o
  decomposition: ModelRef; // 需要深度推理 → Claude Opus
  planning: ModelRef; // 结构化输出 → 任何能力模型
  evidenceExtraction: ModelRef; // 高频低成本 → DeepSeek/GPT-4o-mini
  crossValidation: ModelRef; // 需要推理 → Claude/GPT-4o
  synthesis: ModelRef; // 长输出、高质量 → Claude
}
```

用户可在 `/settings` 页面配置每个 Phase 使用的模型。

---

## 五、搜索与内容提取层

### 5.1 搜索 Provider

| Provider         | 定位              | 特点                                                                  |
| ---------------- | ----------------- | --------------------------------------------------------------------- |
| **Tavily**（主） | AI Agent 专用搜索 | 结构化结果、内容摘要、中英文支持、`search_depth: "advanced"` 可读页面 |
| **Serper**（备） | Google SERP 数据  | 速度快、便宜、某些中文查询更优                                        |

### 5.2 内容提取器

| Extractor                   | 定位     | 特点                                                            |
| --------------------------- | -------- | --------------------------------------------------------------- |
| **Jina Reader**（主）       | 轻量提取 | URL 前加 `https://r.jina.ai/` 即可、返回 Markdown、处理 JS 页面 |
| **Firecrawl**（备）         | 重型提取 | 更强的反爬、JS 渲染、复杂页面                                   |
| **Web Archive**（最终回退） | 缓存版本 | 页面不可达时尝试历史快照                                        |

### 5.3 搜索编排器

```typescript
export class SearchOrchestrator {
  // 每个维度的多轮搜索逻辑
  async searchDimension(dimension: Dimension): Promise<Evidence[]> {
    for (let round = 1; round <= dimension.maxRounds; round++) {
      // 1. 用当前轮关键词搜索（中英文各一组）
      const results = await this.searchWithFallback(keywords);

      // 2. 提取页面内容
      const contents = await this.extractContents(results);

      // 3. LLM 评估证据质量和相关性
      const evidence = await this.evaluateEvidence(contents, dimension);

      // 4. 判断是否满足要求
      if (this.isSufficient(evidence)) break;

      // 5. 未满足 → 基于已有结果调整关键词
      keywords = await this.refineKeywords(evidence, dimension);
    }
  }

  // 带降级的搜索
  private async searchWithFallback(params: SearchParams): Promise<SearchResult[]> {
    try {
      return await this.primaryProvider.search(params); // Tavily
    } catch {
      return await this.fallbackProvider.search(params); // Serper
    }
  }
}
```

### 5.4 速率控制

- 并发搜索：`p-limit(3)` — 最多 3 个并发搜索请求
- 并发提取：`p-limit(5)` — 最多 5 个并发页面提取
- 单会话搜索上限：150 次调用
- 搜索结果缓存：Redis，同查询 24 小时内不重复请求

### 5.5 满足性判断

```typescript
function isSufficient(evidence: Evidence[]): boolean {
  const uniqueSources = new Set(evidence.map((e) => e.url)).size;
  const highCredibility = evidence.filter((e) => e.credibility === "high").length;
  return uniqueSources >= 3 && highCredibility >= 2; // 最低门槛
  // 目标是 5 个独立来源，2+ 高可信
}
```

---

## 六、数据模型

### 6.1 核心实体

```typescript
// ══════════════════════════════════════════
// 研究会话（顶层实体）
// ══════════════════════════════════════════
interface ResearchSession {
  id: string; // ULID
  status: "awaiting_input" | "in_progress" | "completed" | "failed" | "cancelled";
  input: {
    originalText: string;
    validatedProposition: string;
    language: "zh" | "en";
  };
  complexity: "low" | "medium" | "high";
  config: {
    llmProvider: string;
    llmModel: string;
    searchProvider: string;
  };
  phases: PhaseState[];
  tokenUsage: TokenUsage;
  searchCallsUsed: number;
  parentSessionId?: string; // 迭代场景
  createdAt: Date;
  completedAt?: Date;
}

// ══════════════════════════════════════════
// 假设
// ══════════════════════════════════════════
interface Assumption {
  id: string;
  sessionId: string;
  content: string;
  type: "factual" | "judgmental";
  importance: "high" | "medium" | "low";
  order: number;
  verdict?: "supported" | "disputed" | "unsupported";
  evidenceStrength?: "strong" | "medium" | "weak";
}

// ══════════════════════════════════════════
// 研究维度
// ══════════════════════════════════════════
interface Dimension {
  id: string;
  sessionId: string;
  name: string;
  coreQuestion: string;
  counterQuestion: string; // 反向质疑
  assumptionIds: string[];
  keywords: { zh: string[]; en: string[] };
  status: "pending" | "searching" | "completed" | "insufficient";
  currentRound: number;
  maxRounds: number; // 5
  sourcesFound: number;
  highCredibilitySources: number;
  verdict?: "supported" | "disputed" | "unsupported";
  confidence?: "high" | "medium" | "low";
  weight?: "high" | "medium" | "low";
}

// ══════════════════════════════════════════
// 证据
// ══════════════════════════════════════════
interface Evidence {
  id: string;
  sessionId: string;
  dimensionId: string;
  searchQuery: string;
  searchRound: number;
  url: string;
  title: string;
  sourceName: string;
  sourceType: "official_doc" | "statistics" | "academic" | "industry_report" | "case_study" | "community" | "media";
  credibility: "high" | "medium" | "low";
  publishedDate?: string;
  language: "zh" | "en";
  keyExcerpt: string;
  relationship: "supports" | "weakens" | "qualifies";
  timelinessRisk: boolean;
  retrievedAt: Date;
}

// ══════════════════════════════════════════
// 交叉验证
// ══════════════════════════════════════════
interface CrossValidation {
  id: string;
  sessionId: string;
  dimensionId: string;
  evidenceIds: string[];
  consistent: boolean;
  contradictionReason?: "source_bias" | "time_difference" | "scope_mismatch" | "methodology_difference";
}

// ══════════════════════════════════════════
// 报告
// ══════════════════════════════════════════
interface Report {
  id: string;
  sessionId: string;
  version: number; // 迭代时递增
  markdownContent: string;
  overallScore: string; // "5.5-6.0"
  overallVerdict: "proceed" | "proceed_with_caution" | "hold" | "abandon";
  charCount: number;
  sourceCount: number;
  generatedAt: Date;
}
```

### 6.2 数据库 Schema（PostgreSQL）

```sql
CREATE TABLE research_sessions (
  id              TEXT PRIMARY KEY,
  status          TEXT NOT NULL,
  input           JSONB NOT NULL,
  complexity      TEXT,
  config          JSONB NOT NULL,
  phases          JSONB NOT NULL DEFAULT '[]',
  token_usage     JSONB NOT NULL DEFAULT '{}',
  search_calls_used INTEGER DEFAULT 0,
  parent_session_id TEXT REFERENCES research_sessions(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE assumptions (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES research_sessions(id),
  content         TEXT NOT NULL,
  type            TEXT NOT NULL,
  importance      TEXT NOT NULL,
  "order"         INTEGER NOT NULL,
  verdict         TEXT,
  evidence_strength TEXT
);

CREATE TABLE dimensions (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES research_sessions(id),
  name            TEXT NOT NULL,
  core_question   TEXT NOT NULL,
  counter_question TEXT NOT NULL,
  assumption_ids  TEXT[] NOT NULL,
  keywords        JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  current_round   INTEGER DEFAULT 0,
  max_rounds      INTEGER DEFAULT 5,
  sources_found   INTEGER DEFAULT 0,
  high_credibility_sources INTEGER DEFAULT 0,
  verdict         TEXT,
  confidence      TEXT,
  weight          TEXT
);

CREATE TABLE evidence (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES research_sessions(id),
  dimension_id    TEXT NOT NULL REFERENCES dimensions(id),
  search_query    TEXT NOT NULL,
  search_round    INTEGER NOT NULL,
  url             TEXT NOT NULL,
  title           TEXT,
  source_name     TEXT,
  source_type     TEXT NOT NULL,
  credibility     TEXT NOT NULL,
  published_date  TEXT,
  language        TEXT NOT NULL,
  key_excerpt     TEXT NOT NULL,
  relationship    TEXT NOT NULL,
  timeliness_risk BOOLEAN DEFAULT FALSE,
  retrieved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cross_validations (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES research_sessions(id),
  dimension_id    TEXT NOT NULL REFERENCES dimensions(id),
  evidence_ids    TEXT[] NOT NULL,
  consistent      BOOLEAN NOT NULL,
  contradiction_description TEXT,
  contradiction_reason TEXT
);

CREATE TABLE reports (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES research_sessions(id),
  version         INTEGER NOT NULL DEFAULT 1,
  markdown_content TEXT NOT NULL,
  overall_score   TEXT,
  overall_verdict TEXT,
  char_count      INTEGER,
  source_count    INTEGER,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, version)
);

-- 索引
CREATE INDEX idx_sessions_status ON research_sessions(status);
CREATE INDEX idx_sessions_created ON research_sessions(created_at DESC);
CREATE INDEX idx_assumptions_session ON assumptions(session_id);
CREATE INDEX idx_dimensions_session ON dimensions(session_id);
CREATE INDEX idx_evidence_session ON evidence(session_id);
CREATE INDEX idx_evidence_dimension ON evidence(dimension_id);
CREATE INDEX idx_reports_session ON reports(session_id);
```

---

## 七、Agent 工作流引擎

### 7.1 技术选型：XState v5

**为什么用 XState 而不是简单的 switch/case：**

- 工作流有**并行状态**（Phase 3 各维度并行检索）
- 有**条件转换**（自检失败 → 回退 Phase 3）
- 有**等待外部输入**（Phase 0 追问用户）
- 需要**序列化/恢复**（Worker 崩溃后断点续做）
- 需要**可审计**（状态转换历史）

### 7.2 主状态机

```typescript
import { setup, fromPromise } from "xstate";

export const researchMachine = setup({
  types: {
    context: {} as ResearchContext,
    events: {} as ResearchEvent,
  },
  actors: {
    validateInput: fromPromise(/* ... */),
    decomposeAssumptions: fromPromise(/* ... */),
    createResearchPlan: fromPromise(/* ... */),
    searchDimensions: fromPromise(/* ... */),
    crossValidate: fromPromise(/* ... */),
    synthesizeReport: fromPromise(/* ... */),
    selfCheck: fromPromise(/* ... */),
  },
}).createMachine({
  id: "research",
  initial: "inputValidation",
  context: {
    /* initial context */
  },

  states: {
    // Phase 0：输入验证
    inputValidation: {
      invoke: {
        src: "validateInput",
        onDone: [
          { guard: "inputValid", target: "decomposition" },
          { guard: "needsClarification", target: "awaitingClarification" },
        ],
      },
    },

    // 等待用户回复追问
    awaitingClarification: {
      on: {
        USER_RESPONSE: { target: "inputValidation" },
        CANCEL: { target: "cancelled" },
      },
    },

    // Phase 1：假设拆解
    decomposition: {
      invoke: {
        src: "decomposeAssumptions",
        onDone: { target: "planning", actions: "storeAssumptions" },
      },
    },

    // Phase 2：规划
    planning: {
      invoke: {
        src: "createResearchPlan",
        onDone: { target: "retrieval", actions: "storePlan" },
      },
    },

    // Phase 3：多维度并行检索
    retrieval: {
      invoke: {
        src: "searchDimensions", // 内部并行处理各维度
        onDone: { target: "validation" },
      },
    },

    // Phase 4：交叉验证
    validation: {
      invoke: {
        src: "crossValidate",
        onDone: { target: "synthesis", actions: "storeValidation" },
      },
    },

    // Phase 5：综合输出
    synthesis: {
      initial: "generating",
      states: {
        generating: {
          invoke: {
            src: "synthesizeReport",
            onDone: { target: "selfChecking" },
          },
        },
        selfChecking: {
          invoke: {
            src: "selfCheck",
            onDone: [
              { guard: "passesCheck", target: "complete" },
              { guard: "canRetry", target: "#research.retrieval" }, // 回退一次
              { target: "complete" }, // 接受并标注
            ],
          },
        },
        complete: { type: "final" },
      },
      onDone: { target: "completed" },
    },

    completed: { type: "final" },
    failed: { type: "final" },
    cancelled: { type: "final" },
  },
});
```

### 7.3 维度检索子状态机

```typescript
export const dimensionSearchMachine = setup({
  /* ... */
}).createMachine({
  id: "dimensionSearch",
  initial: "searching",
  context: {
    dimensionId: "",
    currentRound: 0,
    maxRounds: 5,
    evidence: [],
  },

  states: {
    searching: {
      invoke: {
        src: "executeSearchRound",
        onDone: [
          { guard: "sufficientEvidence", target: "complete" },
          { guard: "maxRoundsReached", target: "complete" },
          { target: "refiningKeywords" },
        ],
        onError: { target: "retrying" },
      },
    },

    refiningKeywords: {
      invoke: {
        src: "refineKeywordsFromResults",
        onDone: { target: "searching", actions: "incrementRound" },
      },
    },

    retrying: {
      after: {
        2000: [{ guard: "canRetry", target: "searching" }, { target: "complete" }],
      },
    },

    complete: { type: "final" },
  },
});
```

### 7.4 重试与降级策略

| 故障类型                 | 策略                                        |
| ------------------------ | ------------------------------------------- |
| 搜索 API 超时            | 重试 1 次（5s 延迟），失败切备用 Provider   |
| 搜索返回 0 结果          | 调整关键词（扩大范围/换语言），最多 3 轮    |
| 页面无法提取             | Jina → Firecrawl → Web Archive → 跳过并记录 |
| LLM API 错误             | 指数退避重试（1s/2s/4s），3 次后切备用模型  |
| 触发限流                 | 排队等待，尊重 Retry-After                  |
| 维度 5 轮后仍不足 3 来源 | 标注"证据不足"，继续后续阶段                |

### 7.5 持久化与恢复

- 每次状态转换后将 context 写入 PostgreSQL
- Worker 崩溃时 BullMQ 自动重试（`attempts: 3`）
- Worker 加载持久化状态，从最后完成的 Phase 继续
- Phase 3 已收集的证据被保留，仅重做未完成维度

---

## 八、实时通信

### 8.1 方案：SSE + Redis PubSub

**为什么 SSE 而非 WebSocket：**

| 因素       | SSE                          | WebSocket                 |
| ---------- | ---------------------------- | ------------------------- |
| 方向       | 单向（服务端→客户端）        | 双向                      |
| 我们的需求 | 进度推送仅需 server→client   | 用户操作走 REST           |
| 基础设施   | CDN/LB 无需特殊配置          | 需要 sticky session       |
| 重连       | 内置自动重连 + Last-Event-ID | 需手动实现                |
| 复杂度     | 极简（就是 HTTP）            | 连接升级、心跳、ping/pong |

### 8.2 实现

**服务端（Hono）：**

```typescript
app.get("/api/research/:id/stream", async (c) => {
  const sessionId = c.req.param("id");

  return streamSSE(c, async (stream) => {
    // 1. 发送 catchup 事件（该会话所有历史事件）
    const pastEvents = await redis.xrange(`events:${sessionId}`, "-", "+");
    for (const event of pastEvents) {
      await stream.writeSSE({ data: JSON.stringify(event), id: event.id });
    }

    // 2. 订阅实时事件（Redis PubSub）
    const subscriber = redis.duplicate();
    await subscriber.subscribe(`research:${sessionId}:events`);
    subscriber.on("message", async (_, message) => {
      await stream.writeSSE({ data: message, id: generateId() });
    });

    // 3. 心跳保活（30s）
    const heartbeat = setInterval(() => {
      stream.writeSSE({ data: "", event: "heartbeat" });
    }, 30_000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      subscriber.unsubscribe();
      subscriber.quit();
    });
  });
});
```

**客户端（React Hook）：**

```typescript
export function useResearchStream(sessionId: string) {
  const update = useProgressStore((s) => s.update);

  useEffect(() => {
    const es = new EventSource(`/api/research/${sessionId}/stream`);
    es.onmessage = (event) => update(JSON.parse(event.data));
    es.onerror = () => {
      /* 浏览器自动重连，Last-Event-ID 保证不丢事件 */
    };
    return () => es.close();
  }, [sessionId]);
}
```

### 8.3 事件持久化

所有事件写入 Redis Stream（`XADD`），按 sessionId 分 key。用途：

- 断线重连时通过 `XRANGE` 补发
- 7 天后自动过期（Redis TTL）

---

## 九、存储方案

### 9.1 PostgreSQL — 主数据

| 存什么                       | 为什么                                  |
| ---------------------------- | --------------------------------------- |
| 会话、假设、维度、证据、报告 | 关系型数据、需要事务、需要持久          |
| JSONB 字段                   | 灵活 schema（phases、keywords、config） |
| 全文搜索                     | 搜索历史报告                            |

**推荐服务：** Neon（Serverless PostgreSQL，冷启动快，按用量计费）或 Supabase

**ORM：** Drizzle — 零开销、类型推断优于 Prisma、原生 JSONB 支持

### 9.2 Redis — 队列/缓存/PubSub

| 用途        | 说明                                          |
| ----------- | --------------------------------------------- |
| BullMQ 队列 | 研究作业调度、进度追踪、重试                  |
| PubSub      | SSE 事件分发（Worker → API Server）           |
| Streams     | 事件历史（用于 SSE catchup）                  |
| Cache       | LLM 响应缓存（7 天）、搜索结果缓存（24 小时） |

**推荐服务：** Upstash（Serverless Redis，按请求计费）或 Railway 自带 Redis

### 9.3 对象存储（可选）— Cloudflare R2

| 存什么             | 为什么               |
| ------------------ | -------------------- |
| 提取的完整页面内容 | 可能很大，不放数据库 |
| 导出的 PDF 报告    | 静态文件             |
| 证据存档截图       | 审计追溯             |

---

## 十、部署方案

### 10.1 本地开发

```yaml
# docker-compose.yml
services:
  web: # Next.js 前端 (port 3000)
    build: ./apps/web
    ports: ["3000:3000"]

  api: # Hono 后端 (port 4000)
    build: ./apps/api
    ports: ["4000:4000"]
    depends_on: [postgres, redis]

  worker: # BullMQ Worker (同 api 代码，不同入口)
    build: ./apps/api
    command: node dist/worker.js
    depends_on: [postgres, redis]

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

### 10.2 生产部署

| 服务            | 平台              | 理由                            |
| --------------- | ----------------- | ------------------------------- |
| 前端 (Next.js)  | Vercel            | 针对 Next.js 优化、CDN 全球分发 |
| 后端 (Hono)     | Railway           | 支持长时运行 Worker、简单部署   |
| Worker (BullMQ) | Railway           | 与 API 同部署平台、共享数据库   |
| PostgreSQL      | Railway / Neon    | Managed、自动备份               |
| Redis           | Railway / Upstash | Managed、持久化                 |

**为什么不用 Serverless（Vercel Functions/Cloudflare Workers）：**

- 研究会话运行 10-60 分钟，Serverless 有执行时间限制（通常 10s-300s）
- Worker 需要持久连接（Redis、PubSub）

### 10.3 CI/CD

```
push to main → lint + typecheck + test → build → deploy
push to PR   → lint + typecheck + test → preview deploy
```

工具：GitHub Actions

---

## 十一、项目结构

```
contritas/
├── package.json                          # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json                            # Turborepo 构建编排
├── tsconfig.base.json                    # 共享 TS 配置
├── .env.example
├── docker-compose.yml
│
├── apps/
│   ├── web/                              # Next.js 前端
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── src/
│   │       ├── app/                      # App Router 页面
│   │       │   ├── page.tsx              # 首页/输入
│   │       │   ├── research/[id]/page.tsx
│   │       │   ├── report/[id]/page.tsx
│   │       │   ├── history/page.tsx
│   │       │   └── settings/page.tsx
│   │       ├── components/               # UI 组件（见 2.3）
│   │       ├── hooks/
│   │       │   ├── use-research-stream.ts
│   │       │   └── use-progress-store.ts
│   │       └── lib/
│   │           └── api-client.ts         # 类型安全 API 客户端
│   │
│   └── api/                              # Hono 后端 + Worker
│       ├── package.json
│       └── src/
│           ├── index.ts                  # Hono app 入口
│           ├── worker.ts                 # BullMQ worker 入口
│           ├── routes/
│           │   ├── research.ts
│           │   ├── history.ts
│           │   └── settings.ts
│           ├── services/
│           │   ├── session.service.ts
│           │   ├── report.service.ts
│           │   └── stream.service.ts
│           ├── jobs/
│           │   ├── research.job.ts       # 主研究作业
│           │   └── dimension.job.ts      # 维度检索子作业
│           └── drizzle/
│               ├── schema.ts
│               └── migrations/
│
├── packages/
│   ├── shared/                           # 共享类型和工具
│   │   └── src/
│   │       ├── types/
│   │       │   ├── entities.ts           # 实体接口
│   │       │   ├── events.ts             # 进度事件类型
│   │       │   └── api.ts                # API 请求/响应类型
│   │       ├── constants.ts
│   │       └── utils/
│   │           └── validation.ts         # Zod schemas
│   │
│   ├── workflow/                          # Agent 状态机
│   │   └── src/
│   │       ├── machine.ts                # XState 主状态机
│   │       ├── dimension-machine.ts      # 维度检索子状态机
│   │       ├── actors/                   # 各 Phase 执行逻辑
│   │       │   ├── validate-input.ts
│   │       │   ├── decompose.ts
│   │       │   ├── plan.ts
│   │       │   ├── search-dimension.ts
│   │       │   ├── cross-validate.ts
│   │       │   ├── synthesize.ts
│   │       │   └── self-check.ts
│   │       └── guards.ts
│   │
│   ├── llm/                              # LLM 抽象层
│   │   └── src/
│   │       ├── types.ts                  # Provider 接口
│   │       ├── factory.ts                # Provider 工厂
│   │       ├── router.ts                 # Phase → Model 路由
│   │       ├── providers/
│   │       │   ├── claude.ts
│   │       │   ├── openai.ts
│   │       │   ├── deepseek.ts
│   │       │   └── gemini.ts
│   │       └── prompts/                  # 各 Phase 系统提示词
│   │           ├── phase0-validate.ts
│   │           ├── phase1-decompose.ts
│   │           ├── phase2-plan.ts
│   │           ├── phase3-extract.ts
│   │           ├── phase4-validate.ts
│   │           └── phase5-synthesize.ts
│   │
│   └── search/                           # 搜索与内容提取
│       └── src/
│           ├── types.ts
│           ├── orchestrator.ts           # 多轮搜索编排
│           ├── providers/
│           │   ├── tavily.ts
│           │   ├── serper.ts
│           │   └── fallback.ts
│           ├── extractors/
│           │   ├── jina.ts
│           │   ├── firecrawl.ts
│           │   └── web-archive.ts
│           ├── rate-limiter.ts
│           └── deduplicator.ts           # URL 去重
│
├── docs/
│   ├── prd/
│   │   └── prd.md
│   └── architecture/
│       └── technical-design.md           # 本文档
│
└── scripts/
    ├── dev.sh                            # 启动本地开发环境
    └── db-migrate.sh                     # 执行数据库迁移
```

### Monorepo 工具链

| 工具                       | 用途                                   |
| -------------------------- | -------------------------------------- |
| pnpm                       | 包管理（workspace protocol、磁盘高效） |
| Turborepo                  | 构建编排（并行构建、缓存、任务依赖）   |
| ESLint + typescript-eslint | 代码规范                               |
| Prettier                   | 格式化                                 |
| Vitest                     | 单元/集成测试                          |
| Zod                        | 前后端共享的校验 Schema                |

---

## 十二、PRD 需求映射

| PRD 需求           | 技术实现                                                 |
| ------------------ | -------------------------------------------------------- |
| 4.1 假设拆解       | Phase 1 Actor (`decompose.ts`) + LLM 结构化输出          |
| 4.2 动态维度生成   | Phase 2 Actor (`plan.ts`)                                |
| 4.3 多源证据检索   | Phase 3 + Search Orchestrator + 多轮检索                 |
| 4.4 证据质量评估   | Phase 3 LLM 评估 + Evidence 实体的 credibility 字段      |
| 4.5 交叉验证       | Phase 4 Actor (`cross-validate.ts`)                      |
| 4.6 定量测算       | Phase 4 条件触发 + LLM 计算                              |
| 4.7 综合判断与评分 | Phase 5 Actor (`synthesize.ts`) + 评分规则               |
| 4.8 行动建议       | Phase 5 报告生成的一部分                                 |
| 4.9 引用管理       | Evidence 自动编号 + 报告模板中的引用标记                 |
| 4.10 输入预处理    | Phase 0 Actor (`validate-input.ts`) + 追问机制           |
| 4.11 多轮交互      | SSE + `/respond` + `/iterate` API                        |
| 4.12 检索降级      | Search Orchestrator 的 fallback 链 + 状态机重试逻辑      |
| 4.13 评分机制      | Phase 5 评分逻辑（含一票否决、加权、区间）               |
| 4.14 长度自适应    | Phase 2 确定 complexity → Phase 5 按长度目标生成         |
| 4.15 报告迭代      | `/iterate` API → 新 Session（parentSessionId）或维度追加 |

---

## 十三、技术风险与应对

| 风险              | 影响                               | 应对                                                                      |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| 搜索 API 成本过高 | 高复杂度会话 150 次搜索            | 搜索结果缓存 24h；相似查询去重；Tavily advanced 模式减少提取次数          |
| LLM 成本不可控    | 单次研究可能消耗大量 token         | Model Router 分层：贵模型用于关键 Phase，便宜模型用于提取；Token 预算机制 |
| 长时任务可靠性    | 60 分钟内 Worker/Redis/DB 可能故障 | XState 持久化 + BullMQ 重试 + 幂等设计                                    |
| 搜索结果中文质量  | Tavily 中文覆盖可能不全            | Serper 备份 + 百度/搜狗 API 可选扩展                                      |
| 页面提取失败率    | 部分网站反爬严格                   | 多提取器降级链 + 接受部分缺失（PRD 允许标注"证据不足"）                   |

---

## 十四、实施路线建议

### Phase 1：核心骨架（2 周）✅ 已完成

- Monorepo 搭建（pnpm + Turborepo）
- Hono API + BullMQ Worker 基础
- PostgreSQL + Drizzle schema
- 多 LLM Provider 接入（Claude + OpenAI Compatible + 自定义 baseURL）
- Phase 0-2 实现（输入验证 → 假设拆解 → 规划）

### Phase 2：搜索引擎（2 周）

- Tavily 搜索接入
- Jina Reader 内容提取
- Search Orchestrator 多轮检索
- Phase 3 实现（多维度并行检索）
- Redis + SSE 进度推送

### Phase 3：分析与报告（2 周）

- Phase 4 交叉验证实现
- Phase 5 报告综合生成
- 评分机制实现
- 报告模板渲染
- 自检与回退逻辑

### Phase 4：前端（2 周）

- Next.js 应用搭建
- 输入页面 + 进度面板
- 报告查看器（Markdown 渲染 + 目录导航）
- 历史列表
- 迭代/深挖交互

### Phase 5：优化与扩展（1 周）

- Model Router 按 Phase 路由到不同模型
- 成本监控与 Token 预算机制
- 搜索结果缓存优化
- 更多 Provider 扩展（如需）
