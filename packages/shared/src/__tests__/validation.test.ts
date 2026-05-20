import { describe, it, expect } from "vitest";
import {
  createResearchSchema,
  userRespondSchema,
  sessionIdSchema,
  iterateResearchSchema,
  PROPOSITION_MAX,
  USER_RESPONSE_MAX,
  ITERATE_DETAILS_MAX,
} from "../utils/validation.js";
import { stripControlChars } from "../utils/sanitize.js";

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

describe("input length limits", () => {
  it("rejects proposition longer than max", () => {
    const result = createResearchSchema.safeParse({
      proposition: "a".repeat(PROPOSITION_MAX + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts proposition at exact max", () => {
    const result = createResearchSchema.safeParse({
      proposition: "a".repeat(PROPOSITION_MAX),
    });
    expect(result.success).toBe(true);
  });

  it("rejects response longer than max", () => {
    const result = userRespondSchema.safeParse({
      response: "a".repeat(USER_RESPONSE_MAX + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects iterate details longer than max", () => {
    const result = iterateResearchSchema.safeParse({
      type: "deep_dive",
      details: "a".repeat(ITERATE_DETAILS_MAX + 1),
    });
    expect(result.success).toBe(false);
  });
});

describe("control character stripping", () => {
  it("removes C0 control chars but keeps \\n \\r \\t", () => {
    const input = "hello\x00\x01world\nline2\ttab\rreturn";
    expect(stripControlChars(input)).toBe("helloworld\nline2\ttab\rreturn");
  });

  it("strips control chars before length check", () => {
    const padding = "\x00".repeat(100);
    const text = "valid proposition for research";
    const result = createResearchSchema.safeParse({
      proposition: padding + text + padding,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.proposition).toBe(text);
    }
  });

  it("rejects payload that is all control chars (post-strip too short)", () => {
    const result = createResearchSchema.safeParse({
      proposition: "\x00".repeat(500),
    });
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
