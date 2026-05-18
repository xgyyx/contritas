import { describe, it, expect } from "vitest";
import {
  createResearchSchema,
  userRespondSchema,
  sessionIdSchema,
} from "../utils/validation.js";

describe("createResearchSchema", () => {
  it("accepts valid proposition", () => {
    const result = createResearchSchema.safeParse({
      proposition: "Rust比Go更适合构建高并发Web服务",
    });
    expect(result.success).toBe(true);
  });

  it("accepts proposition with optional fields", () => {
    const result = createResearchSchema.safeParse({
      proposition: "独立开发者出海月入5万是否可行",
      language: "zh",
      config: { llmProvider: "claude", llmModel: "claude-sonnet-4-20250514" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects short proposition", () => {
    const result = createResearchSchema.safeParse({
      proposition: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing proposition", () => {
    const result = createResearchSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid language", () => {
    const result = createResearchSchema.safeParse({
      proposition: "This is a valid proposition for testing",
      language: "fr",
    });
    expect(result.success).toBe(false);
  });
});

describe("userRespondSchema", () => {
  it("accepts valid response", () => {
    const result = userRespondSchema.safeParse({
      response: "I want to research AI agents in 2026",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty response", () => {
    const result = userRespondSchema.safeParse({ response: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing response", () => {
    const result = userRespondSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("sessionIdSchema", () => {
  it("accepts valid ULID", () => {
    const result = sessionIdSchema.safeParse("01KRX78Z5TEE3PK9WBZK5KKWNM");
    expect(result.success).toBe(true);
  });

  it("rejects invalid format", () => {
    const result = sessionIdSchema.safeParse("not-a-ulid");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = sessionIdSchema.safeParse("");
    expect(result.success).toBe(false);
  });
});
