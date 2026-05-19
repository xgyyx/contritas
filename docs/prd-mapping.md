# PRD → 技术实现映射表

> 将 PRD 功能需求映射到具体的技术实现位置，便于追踪覆盖度。
>
> 相关文档：[PRD](./prd/prd.md) | [架构总览](./architecture/overview.md)

---

| PRD 需求             | 后端实现                                                        | 前端覆盖 | 状态      |
| -------------------- | --------------------------------------------------------------- | -------- | --------- |
| 4.1 假设拆解         | Phase 1 Actor (`packages/workflow/src/actors/decompose.ts`) + LLM 结构化输出 | 进度面板展示拆解结果 | ✅ 已实现 |
| 4.2 动态维度生成     | Phase 2 Actor (`packages/workflow/src/actors/plan.ts`)          | `dimension-progress` 卡片展示 | ✅ 已实现 |
| 4.3 多源证据检索     | Phase 3 + SearchOrchestrator (`packages/search/src/orchestrator.ts`) | `search-log` + `evidence-feed` 实时展示 | ✅ 已实现 |
| 4.4 证据质量评估     | Phase 3 LLM 评估 + Evidence 实体的 credibility 字段            | `evidence-feed` 可信度标签（高/中/低） | ✅ 已实现 |
| 4.5 交叉验证         | Phase 4 Actor (`packages/workflow/src/actors/cross-validate.ts`) | 报告中矛盾分析章节 | ✅ 已实现 |
| 4.6 定量测算         | Phase 5 报告综合中内含定量分析逻辑                              | 报告 Markdown 渲染 | ✅ 已实现 |
| 4.7 综合判断与评分   | Phase 5 Actor (`packages/workflow/src/actors/synthesize-report.ts`) + 评分规则 | `report-header` 评分展示 | ✅ 已实现 |
| 4.8 行动建议         | Phase 5 报告第七节（如果推进/暂缓/否定）                        | 报告 Markdown 渲染 | ✅ 已实现 |
| 4.9 引用管理         | Phase 5 报告模板中 [来源编号] 引用 + 第八节参考来源表           | Markdown 链接渲染（新标签页打开） | ✅ 已实现 |
| 4.10 输入预处理      | Phase 0 Actor (`packages/workflow/src/actors/validate-input.ts`) | `input-form` 客户端校验 + 服务端 Phase 0 | ✅ 已实现 |
| 4.11 多轮交互        | SSE `clarification` 事件 + `/respond` API                       | `clarification-dialog` 追问弹窗 | ✅ 已实现 |
| 4.12 检索降级        | SearchOrchestrator fallback 链 + 状态机重试逻辑                 | `error-banner` 降级提示 | ✅ 已实现 |
| 4.13 评分机制        | Phase 5 加权评分 + one-veto 规则 + 区间分                       | `report-header` 分数 + 结论徽章 | ✅ 已实现 |
| 4.14 长度自适应      | Phase 2 确定 complexity → Phase 5 按 REPORT_CHAR_TARGETS 生成   | `session-stats` 复杂度展示 | ✅ 已实现 |
| 4.15 报告迭代        | `POST /api/research/:id/iterate` API                            | `iterate-panel` 深挖/新增维度 | ✅ 已实现 |
