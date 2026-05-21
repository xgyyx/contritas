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
- `ChatParams` — 聊天请求参数（model、messages、temperature、maxTokens、systemPrompt、`cacheSystem`）
- `ChatResponse` — 响应体（content、usage、finishReason）
- `StructuredParams<T>` — 结构化输出参数，使用 Zod schema 校验输出（继承 `cacheSystem`）
- `TokenUsage` — Token 用量追踪（inputTokens、outputTokens、estimatedCostUSD，可选 `cacheReadInputTokens` / `cacheCreationInputTokens`）

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

## 四、Model Router（Sprint C 两档路由）

Model Router 把 6 个 phase 映射到 **default** 与 **cheap** 两档模型，policy 在 `packages/llm/src/router.ts` 的 `DEFAULT_PHASE_TIERS` 中。

| Phase             | Tier    | 理由                            |
| ----------------- | ------- | ------------------------------- |
| inputValidation   | cheap   | 二分类、低风险                  |
| decomposition     | default | 决定整研究框架质量              |
| planning          | default | 查询设计的复利效应              |
| retrieval         | cheap   | 证据提取本质机械                |
| validation        | default | 跨源推理                        |
| synthesis         | default | 最终输出质量                    |

**配置方式**（env）：

```bash
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-xxx

# 默认（高价值）模型 —— session 创建时可在 config.llmModel 覆盖
# （历史上从 OPENAI_COMPATIBLE_MODEL 读取，留作 fallback）
# Cheap-tier 模型 —— 留空则与默认模型一致（退化为单模型行为）
LLM_MODEL_CHEAP=claude-haiku-3-5-20241022
```

**API**：

```typescript
import { ModelRouter, createTieredRoutingConfig } from "@contritas/llm";

const router = new ModelRouter(
  createTieredRoutingConfig("claude", "claude-sonnet-4-20250514", "claude-haiku-3-5-20241022")
);

router.getModelForPhase("synthesis"); // { provider: "claude", model: "claude-sonnet-4-..." }
router.getModelForPhase("retrieval"); // { provider: "claude", model: "claude-haiku-3-5-..." }
```

向下兼容：`createDefaultRoutingConfig(provider, model)` 仍可用，等价于 `createTieredRoutingConfig(provider, model, model)`。

**Search Orchestrator**：`buildSearchDeps(searchConfig, cheapModel)` 把 cheap-tier 模型注入 `SearchDeps.evidenceEvalModel`；orchestrator 用它做 evidence eval 与 keyword refine。

---

## 五、Structured Output 实现（Sprint C）

为提高 JSON 解析鲁棒性，`structuredOutput()` 走 provider 原生结构化输出，并对不支持的部署 silent fallback 到 prompt-only 策略。

```
Claude:            messages.create + tools[{ name: "respond", input_schema }] + tool_choice
                   ↓ 不支持时
                   structuredOutputViaPrompt（"请仅返回 JSON" + 2 次解析重试）

OpenAI-compatible: response_format: { type: "json_schema", strict: true }
                   ↓ strict 不支持
                   response_format: { type: "json_schema", strict: false }
                   ↓ response_format 也不支持
                   structuredOutputViaPrompt
```

依赖：[`zod-to-json-schema`](https://www.npmjs.com/package/zod-to-json-schema) 把 `z.ZodSchema` 转 JSON Schema。helper 在 `packages/llm/src/structured/json-schema.ts`；fallback predicates 在 `structured/predicates.ts`（每个 (provider, model) 仅 fallback debug 一次以抑制日志）。

---

## 六、Prompt Caching（Anthropic ephemeral）

`ChatParams.cacheSystem: true` 时，Claude provider 把 `system` 字段渲染为带 `cache_control: { type: "ephemeral" }` 的 TextBlockParam，让 Anthropic 在 5 分钟 TTL 内复用 prompt prefix。

**开启位置**：synthesize-report（PHASE5_SYSTEM_PROMPT ~5KB）、cross-validate（PHASE4_SYSTEM_PROMPT ~3KB）。这些 system 在 self-check 重试与 iterate 流程里相同，命中率高。其他 actor 太短，不值得开。

**计费 / 监控**：`TokenUsage.cacheReadInputTokens`（按基准输入价 10% 计）与 `cacheCreationInputTokens`（按 125% 计）会在响应里返回。`buildUsage()` 直接折算到 `estimatedCostUSD`。

```typescript
const { usage } = await llmProvider.structuredOutput({
  systemPrompt: PHASE5_SYSTEM_PROMPT,
  cacheSystem: true,
  // ...
});
// usage.cacheReadInputTokens > 0 即说明 cache 命中。
```

---

## 七、Prompt 管理

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
