import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

/**
 * Convert a Zod schema to a JSON Schema suitable for provider-native
 * structured output (Claude tool_use input_schema, OpenAI response_format
 * json_schema). $refStrategy=none inlines all definitions because both
 * providers reject (or silently ignore) $ref chains.
 */
export function toJsonSchema(schema: z.ZodSchema<unknown>, name = "respond"): Record<string, unknown> {
  const result = zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
    target: "openApi3",
  }) as Record<string, unknown>;

  // zod-to-json-schema with a `name` wraps the result as
  // { $ref, definitions: { [name]: <schema> } }. Strip the wrapper so we get
  // the bare schema; this is what providers expect for tool input / response
  // format payloads.
  const defs = result.definitions as Record<string, unknown> | undefined;
  if (defs && defs[name]) {
    return defs[name] as Record<string, unknown>;
  }
  return result;
}
