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

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  readonly models = CLAUDE_MODELS;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const messages = params.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
      system: params.systemPrompt,
      messages,
    });

    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const usage = this.calculateUsage(
      params.model,
      response.usage.input_tokens,
      response.usage.output_tokens
    );

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
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
      system: params.systemPrompt,
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
    const systemPrompt = [
      params.systemPrompt ?? "",
      "\n\nIMPORTANT: You must respond with valid JSON only. No markdown formatting, no code blocks, no extra text. Just the JSON object.",
    ].join("");

    // Try up to 2 times
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.chat({
        model: params.model,
        messages: params.messages,
        systemPrompt,
        temperature: params.temperature ?? 0,
        maxTokens: params.maxTokens ?? 4096,
      });

      try {
        // Strip potential markdown code blocks
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
        // On first failure, retry with explicit correction instruction
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

    // Unreachable, but TypeScript needs it
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
