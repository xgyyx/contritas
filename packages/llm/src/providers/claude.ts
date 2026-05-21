import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ModelInfo,
  ChatParams,
  ChatResponse,
  ChatChunk,
  StructuredParams,
  TokenUsage,
} from "../types.js";
import { toJsonSchema } from "../structured/json-schema.js";
import { isUnsupportedToolUseError } from "../structured/predicates.js";

const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    contextWindow: 200000,
    maxOutput: 16384,
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
  },
  {
    id: "claude-haiku-3-5-20241022",
    name: "Claude 3.5 Haiku",
    contextWindow: 200000,
    maxOutput: 8192,
    costPerInputToken: 0.0000008,
    costPerOutputToken: 0.000004,
  },
];

// Anthropic prompt cache pricing multipliers, relative to base input price.
// https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  readonly models = CLAUDE_MODELS;
  private client: Anthropic;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new Anthropic({
      apiKey,
      ...(baseUrl && { baseURL: baseUrl }),
    });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const messages = params.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? this.getMaxOutput(params.model),
      temperature: params.temperature,
      system: this.buildSystem(params.systemPrompt, params.cacheSystem),
      messages,
    });

    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const usage = this.buildUsage(params.model, response.usage);

    return {
      content,
      usage,
      finishReason: response.stop_reason === "end_turn" ? "stop" : "length",
    };
  }

  async *chatStream(params: ChatParams): AsyncIterable<ChatChunk> {
    const messages = params.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens ?? this.getMaxOutput(params.model),
      temperature: params.temperature,
      system: this.buildSystem(params.systemPrompt, params.cacheSystem),
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { content: event.delta.text, done: false };
      }
    }

    yield { content: "", done: true };
  }

  async structuredOutput<T>(
    params: StructuredParams<T>
  ): Promise<{ data: T; usage: TokenUsage }> {
    const jsonSchema = toJsonSchema(params.schema, "respond");
    try {
      const response = await this.client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens ?? this.getMaxOutput(params.model),
        temperature: params.temperature ?? 0,
        system: this.buildSystem(params.systemPrompt, params.cacheSystem),
        messages: params.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        tools: [
          {
            name: "respond",
            description: "Return the structured response.",
            input_schema: jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: "respond" },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        // Provider returned no tool_use block — treat as a structured-output
        // failure and let the prompt fallback have a try.
        return this.structuredOutputViaPrompt(params);
      }

      const validated = params.schema.parse(toolUse.input);
      return { data: validated, usage: this.buildUsage(params.model, response.usage) };
    } catch (err) {
      if (isUnsupportedToolUseError(err)) {
        return this.structuredOutputViaPrompt(params);
      }
      throw err;
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  private getMaxOutput(model: string): number {
    return this.models.find((m) => m.id === model)?.maxOutput ?? 4096;
  }

  /**
   * Build the `system` field. When `cache=true`, return a structured block
   * tagged with `cache_control: ephemeral` so Anthropic caches the prompt
   * for the next 5 minutes. Non-cached calls keep the plain-string form for
   * compatibility with proxies that don't accept block arrays.
   */
  private buildSystem(text: string | undefined, cache: boolean | undefined) {
    if (!text) return undefined;
    if (!cache) return text;
    // cache_control is GA on the standard endpoint but isn't reflected in
    // the 0.32 SDK type for TextBlockParam — cast to bypass.
    return [
      {
        type: "text" as const,
        text,
        cache_control: { type: "ephemeral" },
      },
    ] as unknown as Anthropic.TextBlockParam[];
  }

  /**
   * Fallback to the legacy JSON-only prompt strategy when the provider
   * doesn't support tool_use (rare for Claude but possible behind a proxy).
   * Mirrors the pre-Sprint-C implementation: 2 attempts, JSON-only system
   * suffix, strip markdown fences, parse + validate.
   */
  private async structuredOutputViaPrompt<T>(
    params: StructuredParams<T>
  ): Promise<{ data: T; usage: TokenUsage }> {
    const systemPrompt = [
      params.systemPrompt ?? "",
      "\n\nIMPORTANT: You must respond with valid JSON only. No markdown formatting, no code blocks, no extra text. Just the JSON object.",
    ].join("");

    let messages = params.messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.chat({
        model: params.model,
        messages,
        systemPrompt,
        temperature: params.temperature ?? 0,
        maxTokens: params.maxTokens ?? this.getMaxOutput(params.model),
      });

      try {
        let jsonStr = response.content.trim();
        if (jsonStr.startsWith("```")) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
        }
        const parsed = JSON.parse(jsonStr);
        const validated = params.schema.parse(parsed);
        return { data: validated, usage: response.usage };
      } catch (error) {
        if (attempt === 1) {
          throw new Error(
            `Failed to parse structured output after 2 attempts: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        messages = [
          ...messages,
          { role: "assistant", content: response.content },
          {
            role: "user",
            content:
              "Your response was not valid JSON or did not match the required schema. Please try again with valid JSON only.",
          },
        ];
      }
    }

    throw new Error("Unreachable");
  }

  /**
   * Compute TokenUsage, including Anthropic's prompt-cache token counts when
   * the SDK surfaces them (they live on `usage` but aren't in 0.32 typings).
   * Cache-read tokens are priced at 10% of normal input; cache-creation
   * tokens at 125%.
   */
  private buildUsage(model: string, usage: Anthropic.Usage): TokenUsage {
    const modelInfo = this.models.find((m) => m.id === model) ?? this.models[0];
    const u = usage as Anthropic.Usage & {
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    };

    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const cacheRead = u.cache_read_input_tokens ?? undefined;
    const cacheCreation = u.cache_creation_input_tokens ?? undefined;

    const baseInputCost = inputTokens * modelInfo.costPerInputToken;
    const cacheReadCost = (cacheRead ?? 0) * modelInfo.costPerInputToken * CACHE_READ_MULTIPLIER;
    const cacheCreationCost =
      (cacheCreation ?? 0) * modelInfo.costPerInputToken * CACHE_WRITE_MULTIPLIER;
    const outputCost = outputTokens * modelInfo.costPerOutputToken;

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUSD: baseInputCost + cacheReadCost + cacheCreationCost + outputCost,
      ...(cacheRead !== undefined ? { cacheReadInputTokens: cacheRead } : {}),
      ...(cacheCreation !== undefined ? { cacheCreationInputTokens: cacheCreation } : {}),
    };
  }
}
