import type { Context, Next } from "hono";
import { createHash } from "node:crypto";
import { getRedis } from "../lib/redis.js";

export interface RateLimitOptions {
  /** Logical name used in the Redis key and error message. */
  name: string;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Maximum allowed requests per window. */
  max: number;
  /** Derive the bucket key (excluding prefix). Receives Hono ctx. */
  keyFor: (c: Context) => string | Promise<string>;
}

/**
 * Fixed-window rate limiter backed by Redis INCR + EXPIRE.
 * Returns 429 with Retry-After when exceeded.
 */
export function rateLimit(opts: RateLimitOptions) {
  return async (c: Context, next: Next) => {
    const bucket = await opts.keyFor(c);
    const redis = getRedis();
    const windowStart = Math.floor(Date.now() / 1000 / opts.windowSeconds) * opts.windowSeconds;
    const key = `rl:${opts.name}:${bucket}:${windowStart}`;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, opts.windowSeconds);
    }

    if (count > opts.max) {
      const ttl = await redis.ttl(key);
      const retryAfter = Math.max(ttl, 1);
      c.header("Retry-After", String(retryAfter));
      c.header("X-RateLimit-Limit", String(opts.max));
      c.header("X-RateLimit-Remaining", "0");
      return c.json(
        { error: `Rate limit exceeded for ${opts.name}`, retryAfter },
        429
      );
    }

    c.header("X-RateLimit-Limit", String(opts.max));
    c.header("X-RateLimit-Remaining", String(Math.max(opts.max - count, 0)));

    return next();
  };
}

/**
 * Resolve client IP from common proxy headers, falling back to direct connection.
 * Trusts only the first hop — fine for the single-reverse-proxy deployment model.
 */
export function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = c.req.header("x-real-ip");
  if (real) return real;
  // Hono node-server exposes the request's remote address via the raw request.
  // Fall back to "unknown" so the bucket still works (everyone shares one bucket).
  return "unknown";
}

/**
 * Hash a bearer token for use in rate-limit keys (avoid putting the secret in Redis keys).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}
