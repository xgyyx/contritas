import { describe, it, expect } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "../structured/json-schema.js";
import {
  isUnsupportedToolUseError,
  isStrictUnsupported,
  isJsonSchemaUnsupported,
} from "../structured/predicates.js";

describe("toJsonSchema", () => {
  it("inlines nested objects without $ref", () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        age: z.number().int(),
      }),
      tags: z.array(z.string()),
    });
    const json = toJsonSchema(schema, "respond") as Record<string, unknown>;
    const flat = JSON.stringify(json);

    expect(flat).not.toContain("$ref");
    expect(json.type).toBe("object");
    const props = json.properties as Record<string, unknown>;
    expect(props.user).toBeDefined();
    expect(props.tags).toBeDefined();
  });

  it("handles discriminated unions without $ref", () => {
    const schema = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("a"), value: z.string() }),
      z.object({ kind: z.literal("b"), value: z.number() }),
    ]);
    const json = toJsonSchema(schema, "respond");
    expect(JSON.stringify(json)).not.toContain("$ref");
  });
});

describe("isUnsupportedToolUseError", () => {
  it("detects 400 with tool-related message", () => {
    expect(
      isUnsupportedToolUseError({ status: 400, message: "tools field not supported" })
    ).toBe(true);
    expect(
      isUnsupportedToolUseError({ status: 400, message: "invalid tool_choice" })
    ).toBe(true);
    expect(
      isUnsupportedToolUseError({ status: 400, message: "input_schema invalid" })
    ).toBe(true);
  });

  it("returns false for unrelated 400s", () => {
    expect(
      isUnsupportedToolUseError({ status: 400, message: "rate limit exceeded" })
    ).toBe(false);
  });

  it("returns false for 5xx", () => {
    expect(
      isUnsupportedToolUseError({ status: 500, message: "tool_use error" })
    ).toBe(false);
  });
});

describe("isStrictUnsupported", () => {
  it("detects 400 with 'strict' in body", () => {
    expect(
      isStrictUnsupported({ status: 400, message: "strict mode not implemented" })
    ).toBe(true);
  });

  it("returns false for messages without 'strict'", () => {
    expect(isStrictUnsupported({ status: 400, message: "bad request" })).toBe(false);
  });
});

describe("isJsonSchemaUnsupported", () => {
  it("detects 400 with response_format / json_schema mention", () => {
    expect(
      isJsonSchemaUnsupported({ status: 400, message: "response_format not supported" })
    ).toBe(true);
    expect(
      isJsonSchemaUnsupported({ status: 400, message: "json_schema rejected" })
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isJsonSchemaUnsupported({ status: 400, message: "auth failed" })).toBe(false);
    expect(isJsonSchemaUnsupported({ status: 500, message: "json_schema" })).toBe(false);
  });
});
