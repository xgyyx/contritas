import type {
  LLMProvider,
  ModelInfo,
  ChatParams,
  ChatResponse,
  ChatChunk,
  StructuredParams,
  TokenUsage,
} from "../types.js";

export interface MockCall {
  method: "chat" | "chatStream" | "structuredOutput";
  params: ChatParams | StructuredParams<unknown>;
  timestamp: number;
}

interface MockConfig {
  responses?: string[];
  structuredResponses?: unknown[];
  latencyMs?: number;
}

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCostUSD: 0,
};

export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly models: ModelInfo[] = [
    {
      id: "mock-model",
      name: "Mock Model",
      contextWindow: 100000,
      maxOutput: 8192,
      costPerInputToken: 0,
      costPerOutputToken: 0,
    },
  ];

  private calls: MockCall[] = [];
  private responseIndex = 0;
  private structuredResponseIndex = 0;
  private config: MockConfig;

  constructor(config: MockConfig = {}) {
    this.config = config;
  }

  getCalls(): MockCall[] {
    return [...this.calls];
  }

  getCallCount(): number {
    return this.calls.length;
  }

  reset(): void {
    this.calls = [];
    this.responseIndex = 0;
    this.structuredResponseIndex = 0;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    this.calls.push({ method: "chat", params, timestamp: Date.now() });

    if (this.config.latencyMs) {
      await new Promise((r) => setTimeout(r, this.config.latencyMs));
    }

    const content =
      this.config.responses?.[this.responseIndex] ?? '{"result": "mock response"}';
    this.responseIndex = (this.responseIndex + 1) % (this.config.responses?.length ?? 1);

    return {
      content,
      usage: ZERO_USAGE,
      finishReason: "stop",
    };
  }

  async *chatStream(params: ChatParams): AsyncIterable<ChatChunk> {
    this.calls.push({ method: "chatStream", params, timestamp: Date.now() });

    const content =
      this.config.responses?.[this.responseIndex] ?? "mock streaming response";
    this.responseIndex = (this.responseIndex + 1) % (this.config.responses?.length ?? 1);

    // Simulate streaming by yielding word by word
    const words = content.split(" ");
    for (const word of words) {
      if (this.config.latencyMs) {
        await new Promise((r) => setTimeout(r, this.config.latencyMs! / words.length));
      }
      yield { content: word + " ", done: false };
    }
    yield { content: "", done: true };
  }

  async structuredOutput<T>(
    params: StructuredParams<T>
  ): Promise<{ data: T; usage: TokenUsage }> {
    this.calls.push({ method: "structuredOutput", params, timestamp: Date.now() });

    if (this.config.latencyMs) {
      await new Promise((r) => setTimeout(r, this.config.latencyMs));
    }

    const responseData =
      this.config.structuredResponses?.[this.structuredResponseIndex];
    this.structuredResponseIndex =
      (this.structuredResponseIndex + 1) %
      (this.config.structuredResponses?.length ?? 1);

    if (responseData === undefined) {
      throw new Error(
        "MockProvider: No structured response configured. Pass structuredResponses in config."
      );
    }

    const validated = params.schema.parse(responseData);
    return { data: validated, usage: ZERO_USAGE };
  }
}
