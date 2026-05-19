# PRD → 技术实现映射表

> 将 PRD 功能需求映射到具体的技术实现位置，便于追踪覆盖度。
>
> 相关文档：[PRD](./prd/prd.md) | [架构总览](./architecture/overview.md)

---

| PRD 需求             | 技术实现                                                        | 状态      |
| -------------------- | --------------------------------------------------------------- | --------- |
| 4.1 假设拆解         | Phase 1 Actor (`packages/workflow/src/actors/decompose.ts`) + LLM 结构化输出 | ✅ 已实现 |
| 4.2 动态维度生成     | Phase 2 Actor (`packages/workflow/src/actors/plan.ts`)          | ✅ 已实现 |
| 4.3 多源证据检索     | Phase 3 + SearchOrchestrator (`packages/search/src/orchestrator.ts`) | ✅ 已实现 |
| 4.4 证据质量评估     | Phase 3 LLM 评估 + Evidence 实体的 credibility 字段            | ✅ 已实现 |
| 4.5 交叉验证         | Phase 4 Actor（待实现）                                        | 🔲 Phase 3 |
| 4.6 定量测算         | Phase 4 条件触发 + LLM 计算（待实现）                          | 🔲 Phase 3 |
| 4.7 综合判断与评分   | Phase 5 Actor + 评分规则（待实现）                              | 🔲 Phase 3 |
| 4.8 行动建议         | Phase 5 报告生成的一部分（待实现）                              | 🔲 Phase 3 |
| 4.9 引用管理         | Evidence 自动编号 + 报告模板中的引用标记（待实现）              | 🔲 Phase 3 |
| 4.10 输入预处理      | Phase 0 Actor (`packages/workflow/src/actors/validate-input.ts`) | ✅ 已实现 |
| 4.11 多轮交互        | SSE + `/respond` API                                            | ✅ 部分实现 |
| 4.12 检索降级        | SearchOrchestrator fallback 链 + 状态机重试逻辑                 | ✅ 已实现 |
| 4.13 评分机制        | Phase 5 评分逻辑（待实现）                                      | 🔲 Phase 3 |
| 4.14 长度自适应      | Phase 2 确定 complexity → Phase 5 按长度目标生成（待实现）      | 🔲 Phase 3 |
| 4.15 报告迭代        | `/iterate` API（待实现）                                        | 🔲 Phase 3 |
