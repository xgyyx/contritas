# 数据模型

> 核心实体定义与 PostgreSQL Schema。
>
> 相关文档：[架构总览](./overview.md) | 代码：`apps/api/src/drizzle/schema.ts`

---

## 一、实体关系

```
ResearchSession (1)
  ├── Assumption (1:N)
  ├── Dimension (1:N)
  │     ├── Evidence (1:N)
  │     └── CrossValidation (1:N)
  ├── Report (1:N, 按 version 递增)
  └── ResearchSession (自引用, parentSessionId → 迭代场景)
```

---

## 二、核心实体说明

### ResearchSession（研究会话）

顶层实体，代表一次完整的研究流程。

| 关键字段          | 说明                                                      |
| ----------------- | --------------------------------------------------------- |
| status            | `awaiting_input` / `in_progress` / `completed` / `failed` / `cancelled` |
| input             | JSONB：原始文本、验证后命题、语言                         |
| complexity        | `low` / `medium` / `high`                                 |
| config            | JSONB：llmProvider、llmModel、searchProvider              |
| phases            | JSONB 数组：各 Phase 的状态和结果                         |
| searchCallsUsed   | 搜索调用计数（上限 150）                                  |
| parentSessionId   | 迭代场景下指向父会话                                      |

### Assumption（假设）

从用户命题中拆解出的核心假设。

| 关键字段        | 说明                                      |
| --------------- | ----------------------------------------- |
| type            | `factual`（事实性）/ `judgmental`（判断性） |
| importance      | `high` / `medium` / `low`                 |
| verdict         | `supported` / `disputed` / `unsupported`  |
| evidenceStrength | `strong` / `medium` / `weak`             |

### Dimension（研究维度）

动态生成的研究维度，每个维度对应一组检索任务。

| 关键字段              | 说明                           |
| --------------------- | ------------------------------ |
| coreQuestion          | 该维度要回答的核心问题         |
| counterQuestion       | 反向质疑                       |
| keywords              | JSONB：中英文检索关键词        |
| status                | `pending` / `searching` / `completed` / `insufficient` |
| currentRound / maxRounds | 当前轮 / 最多 5 轮          |
| sourcesFound / highCredibilitySources | 来源计数        |

### Evidence（证据）

检索到的单条证据。

| 关键字段       | 说明                                                                 |
| -------------- | -------------------------------------------------------------------- |
| sourceType     | `official_doc` / `statistics` / `academic` / `industry_report` / `case_study` / `community` / `media` |
| credibility    | `high` / `medium` / `low`                                           |
| relationship   | `supports` / `weakens` / `qualifies`                                |
| timelinessRisk | 超过 2 年的数据标记为 true                                          |
| keyExcerpt     | 关键摘录                                                            |

### CrossValidation（交叉验证）

同一维度内多条证据之间的一致性检查。

| 关键字段              | 说明                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| consistent            | 是否一致                                                                  |
| contradictionReason   | `source_bias` / `time_difference` / `scope_mismatch` / `methodology_difference` |

### Report（报告）

最终输出的研究报告。

| 关键字段       | 说明                                                    |
| -------------- | ------------------------------------------------------- |
| version        | 迭代时递增，与 sessionId 联合唯一                       |
| overallScore   | 字符串形式，如 "5.5-6.0"                                |
| overallVerdict | `proceed` / `proceed_with_caution` / `hold` / `abandon` |
| markdownContent | 完整 Markdown 报告内容                                 |

---

## 三、数据库 Schema（PostgreSQL）

以下为设计参考。实际 Schema 以 `apps/api/src/drizzle/schema.ts` 中的 Drizzle 定义为准。

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
CREATE INDEX idx_sessions_owner ON research_sessions(owner_token_hash);
CREATE INDEX idx_sessions_parent ON research_sessions(parent_session_id);
CREATE INDEX idx_assumptions_session ON assumptions(session_id);
CREATE INDEX idx_dimensions_session ON dimensions(session_id);
CREATE INDEX idx_evidence_session ON evidence(session_id);
CREATE INDEX idx_evidence_dimension ON evidence(dimension_id);
CREATE INDEX idx_cross_validations_session ON cross_validations(session_id);
CREATE INDEX idx_cross_validations_dimension ON cross_validations(dimension_id);
CREATE INDEX idx_reports_session ON reports(session_id);

-- 唯一约束（Phase 6.2 引入，防止并发持久化重复插入）
CREATE UNIQUE INDEX uq_assumptions_session_order ON assumptions(session_id, "order");
CREATE UNIQUE INDEX uq_dimensions_session_name  ON dimensions(session_id, name);
```

---

## 四、稳定 ID 策略（Phase 6.2 引入）

为避免 `evidence.dimension_id → dimensions.id` 的外键失配，所有实体的主键 ULID 在
**workflow 内部**首次生成时即被赋予最终值，全链路（API → workflow → DB）共享同一
ID。具体规则：

| 实体              | 生成位置                                                         |
| ----------------- | ---------------------------------------------------------------- |
| Assumption        | `machine.ts` 的 `decomposition.onDone` action                    |
| Dimension         | `machine.ts` 的 `planning.onDone` action                         |
| Evidence          | `actors/search-dimensions.ts` 在拼装 `EvidenceData` 时           |
| CrossValidation   | `machine.ts` 的 `validation.onDone` action                       |

`apps/api/src/services/workflow.service.ts` 中的 `persistState` 改为基于这些稳定 ID
做 `INSERT ... ON CONFLICT DO UPDATE`：

- 同一 session 多次持久化不再 drop+reinsert，客户端拿到的 `evidence.id` 始终有效。
- `cross_validations.evidence_ids` 存放真实 evidence 主键，可直接 join。
- `dimensions` 的 verdict/confidence 通过 `dimension_id` 命中真实行（不再丢失）。

迭代研究（`createIterateContext`）从父会话读取实体时，**保留原 ID** 写入 child
session 的 context；新生成的实体（add_dimension 模式下的新维度）继续在 onDone 阶段
分配新 ULID。
