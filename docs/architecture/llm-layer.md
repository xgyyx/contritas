# LLM 抽象层

> Adapter 模式 + Model Router，支持多 Provider 切换和按 Phase 路由到不同模型。
>
> 相关文档：[架构总览](./overview.md) | 代码：`packages/llm/`

---

## 一、设计理念

使用 **Adapter 模式** + **Model Router**，不同 Phase 可路由到不同模型：

- 推理密集型 Phase（1、4、5）→ 强模型（Claude Opus / GPT-4o）
- 高频提取型 Phase（3）→ 性价比模型（DeepSeek / GPT-4o-mini）

---

## 二、Provider 接口

核心接口定义见 `packages/llm/src/types.ts`，主要包括：

- `LLMProvider` — 统一的 Provider 接口，包含 `chat()`、`chatStream()`、`structuredOutput()` 三个方法
- `ChatParams` — 聊天请求参数（model、messages、temperature、maxTokens、systemPrompt）
- `ChatResponse` — 响应体（content、usage、finishReason）
- `StructuredParams<T>` — 结构化输出参数，使用 Zod schema 校验输出
- `TokenUsage` — Token 用量追踪（inputTokens、outputTokens、estimatedCostUSD）

---

## 三、已实现的 Provider

| Provider            | SDK                 | 状态      | 用途                                                                          |
| ------------------- | ------------------- | --------- | ----------------------------------------------------------------------------- |
| Claude              | `@anthropic-ai/sdk` | ✅ 已实现 | 深度推理（Phase 1/4/5）、结构化输出；支持自定义 baseURL                       |
| OpenAI Compatible   | `openai`            | ✅ 已实现 | 兼容 OpenAI 格式的任意端点（one-api/litellm/ollama/vLLM/DeepSeek）           |
| Mock                | 内置                | ✅ 已实现 | 测试用途                                                                      |

**配置方式（环境变量）：**

```bash
# 方式 A：Anthropic 官方或 Anthropic 协议代理
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_BASE_URL=https://your-proxy.com   # 可选，留空走官方；非 *.anthropic.com 域名启动时会打印 warn 日志（Phase 6.1.7）

# 方式 B：OpenAI Compatible 端点
LLM_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_API_KEY=sk-xxx
OPENAI_COMPATIBLE_BASE_URL=https://your-proxy.com/v1
OPENAI_COMPATIBLE_MODEL=gpt-4o
```

---

## 四、Model Router

Model Router 允许按 Phase 路由到不同模型，配置结构：

| Phase              | 推荐模型类型         | 理由                     |
| ------------------ | -------------------- | ------------------------ |
| inputValidation    | 需要判断力的模型     | Claude / GPT-4o          |
| decomposition      | 需要深度推理         | Claude Opus              |
| planning           | 结构化输出           | 任何能力模型             |
| evidenceExtraction | 高频低成本           | DeepSeek / GPT-4o-mini   |
| crossValidation    | 需要推理             | Claude / GPT-4o          |
| synthesis          | 长输出、高质量       | Claude                   |

具体配置见 `packages/llm/src/router.ts`。

**使用方式**：`WorkflowDeps.getModelForPhase(phase)` 返回当前 phase 对应的模型名。默认通过 `createDefaultRoutingConfig(provider, model)` 创建配置，所有 phase 使用同一模型。可通过自定义 `ModelRoutingConfig` 实现按 phase 差异化路由。

```typescript
import { ModelRouter, createDefaultRoutingConfig } from "@contritas/llm";

// 默认：所有 phase 用同一模型
const router = new ModelRouter(createDefaultRoutingConfig("claude", "claude-sonnet-4-20250514"));

// 自定义：synthesis 用更强模型
router.updateConfig({
  synthesis: { provider: "claude", model: "claude-opus-4-20250514" },
  evidenceExtraction: { provider: "openai-compatible", model: "gpt-4o-mini" },
});

// 在 WorkflowDeps 中使用
const model = router.getModelForPhase("synthesis"); // { provider: "claude", model: "claude-opus-4-..." }
```

---

## 五、Prompt 管理

各 Phase 的系统提示词位于 `packages/llm/src/prompts/`：

| 文件                        | 对应 Phase | 用途           |
| --------------------------- | ---------- | -------------- |
| `phase0-validate.ts`        | Phase 0    | 输入验证       |
| `phase1-decompose.ts`       | Phase 1    | 假设拆解       |
| `phase2-plan.ts`            | Phase 2    | 研究规划       |
| `phase3-extract.ts`         | Phase 3    | 证据评估       |
| `phase3-refine-keywords.ts` | Phase 3    | 关键词精炼     |
| `phase4-cross-validate.ts`  | Phase 4    | 交叉验证       |
| `phase5-synthesize.ts`      | Phase 5    | 报告综合       |
