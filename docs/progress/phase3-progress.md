# Phase 3: 分析与报告 — 完成记录

> 实现了交叉验证（Agent Phase 4）和报告综合（Agent Phase 5），包括评分、自检回退机制。

---

## 完成内容

### Agent Phase 4: 交叉验证

- **Actor**: `packages/workflow/src/actors/cross-validate.ts`
- **Prompt**: `packages/llm/src/prompts/phase4-cross-validate.ts`
- 按维度分组证据，检测方向性矛盾（supports vs weakens）
- 输出每维度的 verdict/confidence + 矛盾分析
- 矛盾原因分类：`source_bias | time_difference | scope_mismatch | methodology_difference`

### Agent Phase 5: 报告综合

- **Actor**: `packages/workflow/src/actors/synthesize-report.ts`
- **Prompt**: `packages/llm/src/prompts/phase5-synthesize.ts`
- 生成完整 8 段式 Markdown 报告
- 评分机制：加权综合，输出区间分（如 "5.5-6.0"），含 one-veto 规则
- 长度按 complexity 控制

### 自检与回退

- **Self-check**: `packages/workflow/src/utils/self-check.ts`（代码检查，非 LLM）
- 4 项强制检查：反向质疑、证据覆盖、来源表、评分说明
- 失败时回退到 retrieval 进行定向补充搜索（最多 1 次）

### API 端点

- `GET /api/research/:id/report` — 获取生成的报告
- `GET /api/research/:id/evidence` — 获取所有证据
- `POST /api/research/:id/iterate` — 触发迭代研究

### 状态机更新

- 替换 `validationPending` 桩为完整的 `validation` → `synthesis` 状态流
- 支持自检失败回退：`synthesis` → `retrieval`（定向搜索）→ `validation` → `synthesis` → `completed`

---

## 新增/修改文件

| 文件 | 操作 |
|------|------|
| `packages/workflow/src/types.ts` | 扩展 (CrossValidationData, ReportData, SynthesisResult 等) |
| `packages/workflow/src/machine.ts` | 重写 (新增 validation, synthesis 状态) |
| `packages/workflow/src/actors/cross-validate.ts` | 新增 |
| `packages/workflow/src/actors/synthesize-report.ts` | 新增 |
| `packages/workflow/src/utils/self-check.ts` | 新增 |
| `packages/workflow/src/actors/index.ts` | 扩展 |
| `packages/workflow/src/actors/search-dimensions.ts` | 修改 (支持 targetedDimensions) |
| `packages/llm/src/prompts/phase4-cross-validate.ts` | 新增 |
| `packages/llm/src/prompts/phase5-synthesize.ts` | 新增 |
| `packages/llm/src/index.ts` | 扩展 |
| `packages/shared/src/constants.ts` | 扩展 |
| `packages/shared/src/types/events.ts` | 扩展 (ValidationCompleteEvent) |
| `apps/api/src/services/workflow.service.ts` | 扩展 (持久化 + 事件映射) |
| `apps/api/src/services/session.service.ts` | 扩展 (getReport, getEvidence, getCrossValidations) |
| `apps/api/src/routes/research.ts` | 扩展 (3 个新端点) |
| `apps/api/src/jobs/research.job.ts` | 修改 (移除 validationPending workaround) |
| `apps/api/src/lib/queue.ts` | 扩展 (iterate 字段) |

---

## 测试

- `packages/workflow/src/__tests__/self-check.test.ts` — 5 tests
- `packages/workflow/src/__tests__/cross-validate.test.ts` — 3 tests
- `packages/workflow/src/__tests__/synthesize-report.test.ts` — 3 tests
- 原有 machine.test.ts — 5 tests (已更新适配)
