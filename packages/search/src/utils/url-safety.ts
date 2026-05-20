import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(public readonly url: string, public readonly reason: string) {
    super(`Unsafe URL '${url}': ${reason}`);
    this.name = "UnsafeUrlError";
  }
}

const FORBIDDEN_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.azure.com",
  "metadata.azure.net",
  "metadata.aws.internal",
]);

/**
 * Validate that a URL is safe to fetch from an outbound HTTP context.
 * Rejects:
 *   - non-http(s) schemes (file://, gopher://, ...)
 *   - URLs that embed credentials (user:pass@host)
 *   - hostnames that resolve to private / loopback / link-local / multicast IPs
 *   - known cloud metadata endpoints by hostname
 *
 * Throws UnsafeUrlError on rejection.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(rawUrl, "not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(rawUrl, `unsupported protocol '${url.protocol}'`);
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError(rawUrl, "URLs with embedded credentials are not allowed");
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    throw new UnsafeUrlError(rawUrl, "empty hostname");
  }

  if (FORBIDDEN_HOSTNAMES.has(host)) {
    throw new UnsafeUrlError(rawUrl, `hostname '${host}' is a known metadata endpoint`);
  }

  // If hostname is literal IP, check it directly.
  const literalIpVersion = isIP(host);
  if (literalIpVersion !== 0) {
    if (isForbiddenIp(host)) {
      throw new UnsafeUrlError(rawUrl, `IP '${host}' is in a forbidden range`);
    }
    return;
  }

  // Otherwise resolve and check every returned address.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    throw new UnsafeUrlError(rawUrl, `DNS lookup failed: ${(err as Error).message}`);
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(rawUrl, "no DNS records");
  }

  for (const { address } of addresses) {
    if (isForbiddenIp(address)) {
      throw new UnsafeUrlError(rawUrl, `host '${host}' resolves to forbidden IP '${address}'`);
    }
  }
}

export function isForbiddenIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isForbiddenIPv4(ip);
  if (version === 6) return isForbiddenIPv6(ip);
  return true;
}

function isForbiddenIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];

  // 0.0.0.0/8 — current network
  if (a === 0) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (incl. 169.254.169.254 cloud metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24, 192.0.2.0/24 — IETF assigned / docs
  if (a === 192 && b === 0) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 — benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 — reserved
  if (a >= 240) return true;

  return false;
}

function isForbiddenIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // ::1 loopback, :: unspecified
  if (lower === "::1" || lower === "::") return true;
  // fe80::/10 link-local
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // fc00::/7 unique local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // ff00::/8 multicast
  if (lower.startsWith("ff")) return true;
  // ::ffff:0:0/96 IPv4-mapped — check the embedded v4
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    if (isIP(v4) === 4) return isForbiddenIPv4(v4);
  }
  return false;
}
