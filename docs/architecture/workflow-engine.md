# Agent 工作流引擎

> 基于 XState v5 的研究流程状态机。
>
> 相关文档：[架构总览](./overview.md) | [Agent 行为规范](../guides/agent-behavior.md) | 代码：`packages/workflow/`

---

## 一、为什么用 XState

工作流有以下特征，简单的 switch/case 无法满足：

- **并行状态** — Phase 3 各维度并行检索
- **条件转换** — 自检失败 → 回退 Phase 3
- **等待外部输入** — Phase 0 追问用户
- **序列化/恢复** — Worker 崩溃后断点续做
- **可审计** — 状态转换历史

---

## 二、工作流状态图

```
[Phase 0] ──不通过──→ 追问用户 ──收到回复──→ [Phase 0]
    │通过
    ▼
[Phase 1] ──完成──→ [Phase 2] ──完成──→ [Phase 3]
                                            │
                                    ┌───────┴───────┐
                                    │  按维度并行    │
                                    │  每维度≤5轮   │
                                    └───────┬───────┘
                                            │全部完成
                                            ▼
                                      [Phase 4] ──完成──→ [Phase 5]
                                                              │
                                                        自检不通过？
                                                              │是
                                                    回退 Phase 3（≤1次）
                                                              │
                                                        自检通过
                                                              │
                                                         输出报告
```

---

## 三、主状态机

主状态机定义见 `packages/workflow/src/machine.ts`，包含以下状态：

| 状态                    | 对应 Phase | 说明                                           |
| ----------------------- | ---------- | ---------------------------------------------- |
| `inputValidation`       | Phase 0    | 验证用户输入，判断是否可启动研究                |
| `awaitingClarification` | Phase 0    | 等待用户回复追问，接收 `USER_RESPONSE` 事件     |
| `decomposition`         | Phase 1    | LLM 拆解核心假设                                |
| `planning`              | Phase 2    | LLM 生成研究计划（维度 + 关键词）               |
| `retrieval`             | Phase 3    | 多维度并行检索，内部由 SearchOrchestrator 驱动  |
| `validation`            | Phase 4    | 交叉验证，检测证据矛盾                          |
| `synthesis`             | Phase 5    | 生成报告 → 自检 → 回退或完成                    |
| `completed`             | -          | 终态                                             |
| `failed`                | -          | 终态                                             |
| `cancelled`             | -          | 终态                                             |

各状态的 Actor 实现位于 `packages/workflow/src/actors/`。

---

## 四、维度检索子状态机

Phase 3 内部，每个维度的检索由一个子状态机驱动：

| 状态               | 说明                                         |
| ------------------ | -------------------------------------------- |
| `searching`        | 执行当前轮搜索                               |
| `refiningKeywords` | 基于已有结果调整关键词                       |
| `retrying`         | 搜索失败后等待 2 秒重试                      |
| `complete`         | 终态（达到满足条件或最大轮次）               |

转换逻辑：
- 证据足够（≥ 3 来源 + ≥ 2 高可信）→ complete
- 达到最大轮次（5 轮）→ complete（标注"证据不足"）
- 未满足 → refiningKeywords → searching（下一轮）

---

## 五、重试与降级策略

| 故障类型                 | 策略                                        |
| ------------------------ | ------------------------------------------- |
| 搜索 API 超时            | 重试 1 次（5s 延迟），失败切备用 Provider   |
| 搜索返回 0 结果          | 调整关键词（扩大范围/换语言），最多 3 轮    |
| 页面无法提取             | Jina → Firecrawl → Web Archive → 跳过并记录 |
| LLM API 错误             | 指数退避重试（1s/2s/4s），3 次后切备用模型  |
| 触发限流                 | 排队等待，尊重 Retry-After                  |
| 维度 5 轮后仍不足 3 来源 | 标注"证据不足"，继续后续阶段                |

---

## 六、持久化与恢复

- 每次状态转换后将 context 写入 PostgreSQL（`research_sessions.phases` JSONB）
- Worker 崩溃时 BullMQ 自动重试（`attempts: 3`）
- Worker 加载持久化状态，从最后完成的 Phase 继续
- Phase 3 已收集的证据被保留，仅重做未完成维度

---

## 七、幂等性设计

Worker 崩溃恢复时需保证不重复执行 LLM 调用：

- 每个 Phase 完成后将结果持久化到 `research_sessions.phases` (JSONB)
- Worker 恢复时检查 phases 数组，已完成的 Phase 直接跳过
- Phase 3 各维度独立持久化到 `dimensions` 表，仅重做 `status = 'pending' | 'searching'` 的维度
- LLM 调用结果写入前检查目标数据是否已存在（基于 sessionId + phase + dimensionId 唯一性）
