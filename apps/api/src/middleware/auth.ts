import type { Context, MiddlewareHandler, Next } from "hono";
import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "../config.js";
import { hashToken } from "./rate-limit.js";

const config = loadConfig();
const TOKEN_HASHES = config.authTokens.map((t) => hashToken(t));

declare module "hono" {
  interface ContextVariableMap {
    authToken: string;
    authTokenHash: string;
  }
}

/**
 * Extract a Bearer token from the Authorization header, or `?token=` query
 * parameter (used for SSE since EventSource cannot send custom headers).
 */
function extractToken(c: Context): string | null {
  const auth = c.req.header("Authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1]!.trim();
  }
  const queryToken = c.req.query("token");
  if (queryToken) return queryToken.trim();
  return null;
}

function isAllowed(token: string): boolean {
  const candidate = hashToken(token);
  // Use timingSafeEqual to avoid string-comparison timing attacks across the
  // (small) list of allowed tokens.
  const candidateBuf = Buffer.from(candidate);
  return TOKEN_HASHES.some((h) => {
    const known = Buffer.from(h);
    return known.length === candidateBuf.length && timingSafeEqual(known, candidateBuf);
  });
}

export const authMiddleware: MiddlewareHandler = async (c: Context, next: Next) => {
  const token = extractToken(c);
  if (!token || !isAllowed(token)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("authToken", token);
  c.set("authTokenHash", hashToken(token));
  return next();
};
