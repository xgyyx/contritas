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

  constructor(config: OpenAICompatibleConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.models = config.models ?? DEFAULT_MODELS;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
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

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? 4096,
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

    const stream = await this.client.chat.completions.create({
      model: params.model,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? 4096,
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
    const systemPrompt = [
      params.systemPrompt ?? "",
      "\n\nIMPORTANT: You must respond with valid JSON only. No markdown formatting, no code blocks, no extra text. Just the JSON object.",
    ].join("");

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.chat({
        model: params.model,
        messages: params.messages,
        systemPrompt,
        temperature: params.temperature ?? 0,
        maxTokens: params.maxTokens ?? 4096,
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
        params.messages = [
          ...params.messages,
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
