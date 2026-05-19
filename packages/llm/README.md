# @contritas/llm

LLM 抽象层，提供统一接口调用不同模型 Provider，以及研究各阶段的 Prompt 模板。

## Provider

| Provider | 说明 |
|----------|------|
| `ClaudeProvider` | Anthropic Claude API（支持自定义 baseURL） |
| `OpenAICompatibleProvider` | OpenAI 兼容 API（DeepSeek、GPT-4o 等） |
| `MockProvider` | 测试用 mock，记录调用历史 |

## 核心 API

```typescript
import { createProvider, ModelRouter } from "@contritas/llm";

// 通过环境变量自动创建 Provider
const provider = createProvider(config);

// Model Router：按 Phase 路由到不同模型
const router = new ModelRouter(routingConfig);
const response = await router.chat(phaseId, messages);
```

## Prompt 模板

每个研究 Phase 对应一套 system prompt + Zod output schema：

| 文件 | Phase | 用途 |
|------|-------|------|
| `phase0-validate` | 0 | 输入验证与命题判断 |
| `phase1-decompose` | 1 | 假设拆解与权重分配 |
| `phase2-plan` | 2 | 研究规划与搜索策略 |
| `phase3-extract` | 3 | 证据提取与可信度评估 |
| `phase3-refine-keywords` | 3 | 关键词优化 |
| `phase4-cross-validate` | 4 | 交叉验证与矛盾检测 |
| `phase5-synthesize` | 5 | 报告综合与评分 |

## 环境变量

- `LLM_PROVIDER`: `claude` | `openai-compatible`
- `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`
- `OPENAI_COMPATIBLE_API_KEY` / `OPENAI_COMPATIBLE_BASE_URL` / `OPENAI_COMPATIBLE_MODEL`

## 开发

```bash
pnpm typecheck
pnpm test
```
