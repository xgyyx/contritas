import OpenAI from "openai";
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
import { isJsonSchemaUnsupported, isStrictUnsupported } from "../structured/predicates.js";

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  models?: ModelInfo[];
}

const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: "default",
    name: "OpenAI Compatible Model",
    contextWindow: 128000,
    maxOutput: 4096,
    costPerInputToken: 0,
    costPerOutputToken: 0,
  },
];

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai-compatible";
  readonly models: ModelInfo[];
  private client: OpenAI;
  // Per-model fallback memoization — log/warn at most once per (model, downgrade).
  private downgradedStrict = new Set<string>();
  private downgradedJsonSchema = new Set<string>();

  constructor(config: OpenAICompatibleConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.models = config.models ?? DEFAULT_MODELS;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const messages = this.toOpenAIMessages(params);

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? this.getMaxOutput(params.model),
    });

    const choice = response.choices[0];
    const content = choice?.message?.content ?? "";

    const usage = this.calculateUsage(
      params.model,
      response.usage?.prompt_tokens ?? 0,
      response.usage?.completion_tokens ?? 0
    );

    return {
      content,
      usage,
      finishReason: choice?.finish_reason === "stop" ? "stop" : "length",
    };
  }

  async *chatStream(params: ChatParams): AsyncIterable<ChatChunk> {
    const messages = this.toOpenAIMessages(params);

    const stream = await this.client.chat.completions.create({
      model: params.model,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? this.getMaxOutput(params.model),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield { content: delta, done: false };
      }
    }

    yield { content: "", done: true };
  }

  async structuredOutput<T>(
    params: StructuredParams<T>
  ): Promise<{ data: T; usage: TokenUsage }> {
    const jsonSchema = toJsonSchema(params.schema, "respond");
    const messages = this.toOpenAIMessages(params);

    const attempt = (strict: boolean) =>
      this.client.chat.completions.create({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0,
        max_tokens: params.maxTokens ?? this.getMaxOutput(params.model),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "respond",
            schema: jsonSchema as Record<string, unknown>,
            strict,
          },
        } as OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"],
      });

    try {
      const resp = await attempt(true);
      return this.parseStructured(resp, params);
    } catch (err) {
      if (isStrictUnsupported(err)) {
        if (!this.downgradedStrict.has(params.model)) {
          this.downgradedStrict.add(params.model);
        }
        try {
          const resp = await attempt(false);
          return this.parseStructured(resp, params);
        } catch (err2) {
          if (isJsonSchemaUnsupported(err2)) {
            if (!this.downgradedJsonSchema.has(params.model)) {
              this.downgradedJsonSchema.add(params.model);
            }
            return this.structuredOutputViaPrompt(params);
          }
          throw err2;
        }
      }
      if (isJsonSchemaUnsupported(err)) {
        if (!this.downgradedJsonSchema.has(params.model)) {
          this.downgradedJsonSchema.add(params.model);
        }
        return this.structuredOutputViaPrompt(params);
      }
      throw err;
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  private getMaxOutput(model: string): number {
    return this.models.find((m) => m.id === model)?.maxOutput ?? 4096;
  }

  private toOpenAIMessages(params: ChatParams | StructuredParams<unknown>): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (params.systemPrompt) {
      messages.push({ role: "system", content: params.systemPrompt });
    }
    for (const m of params.messages) {
      messages.push({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      } as OpenAI.ChatCompletionMessageParam);
    }
    return messages;
  }

  private parseStructured<T>(
    response: OpenAI.Chat.Completions.ChatCompletion,
    params: StructuredParams<T>
  ): { data: T; usage: TokenUsage } {
    const choice = response.choices[0];
    const content = choice?.message?.content ?? "";
    const usage = this.calculateUsage(
      params.model,
      response.usage?.prompt_tokens ?? 0,
      response.usage?.completion_tokens ?? 0
    );

    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    const parsed = JSON.parse(jsonStr);
    const validated = params.schema.parse(parsed);
    return { data: validated, usage };
  }

  /**
   * Legacy JSON-only prompt path, kept as the final fallback when the
   * provider doesn't support response_format json_schema at all.
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

  private calculateUsage(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): TokenUsage {
    const modelInfo = this.models.find((m) => m.id === model) ?? this.models[0];
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUSD:
        inputTokens * modelInfo.costPerInputToken +
        outputTokens * modelInfo.costPerOutputToken,
    };
  }
}
