/**
 * Error predicates for provider-native structured output fallback chains.
 *
 * Each provider can return 400-level errors when the deployment doesn't
 * support a particular structured-output feature. We detect those errors so
 * we can silently downgrade to a less strict path (or eventually to the
 * legacy JSON-only prompt strategy) without exposing transport errors.
 */

function extractErrorText(err: unknown): { status?: number; text: string } {
  const e = err as { status?: number; message?: string; error?: { message?: string }; response?: { data?: unknown } };
  const parts: string[] = [];
  if (e?.message) parts.push(e.message);
  if (e?.error?.message) parts.push(e.error.message);
  if (e?.response?.data) {
    try {
      parts.push(typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data));
    } catch {
      // ignore
    }
  }
  return { status: e?.status, text: parts.join(" ").toLowerCase() };
}

/** Anthropic returned a 400 indicating tool_use / tool_choice / input_schema is unsupported. */
export function isUnsupportedToolUseError(err: unknown): boolean {
  const { status, text } = extractErrorText(err);
  if (status !== 400 && status !== 422) return false;
  return /tools?\b|tool_choice|input_schema|tool[_ ]use/.test(text);
}

/** OpenAI-compatible returned a 400 indicating `strict: true` is unsupported. */
export function isStrictUnsupported(err: unknown): boolean {
  const { status, text } = extractErrorText(err);
  if (status !== 400 && status !== 422) return false;
  return /\bstrict\b/.test(text);
}

/** OpenAI-compatible returned a 400 indicating response_format json_schema is unsupported. */
export function isJsonSchemaUnsupported(err: unknown): boolean {
  const { status, text } = extractErrorText(err);
  if (status !== 400 && status !== 422 && status !== 404) return false;
  return /response_format|json[_ ]schema/.test(text);
}
