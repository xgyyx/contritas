import { describe, it, expect } from "vitest";
import { assertSafePublicUrl, UnsafeUrlError, isForbiddenIp } from "../utils/url-safety.js";

describe("isForbiddenIp", () => {
  it.each([
    "10.0.0.1",
    "10.255.255.255",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "fe80::1",
    "fc00::1",
    "ff00::1",
  ])("rejects %s", (ip) => {
    expect(isForbiddenIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.0",
    "2606:4700:4700::1111",
  ])("allows %s", (ip) => {
    expect(isForbiddenIp(ip)).toBe(false);
  });
});

describe("assertSafePublicUrl", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(assertSafePublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafePublicUrl("gopher://example.com")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafePublicUrl("ftp://example.com")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects URLs with embedded credentials", async () => {
    await expect(assertSafePublicUrl("https://user:pass@example.com")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects malformed URLs", async () => {
    await expect(assertSafePublicUrl("not a url")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects literal private IP hosts without DNS lookup", async () => {
    await expect(assertSafePublicUrl("http://127.0.0.1/admin")).rejects.toThrow(/forbidden range/);
    await expect(assertSafePublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/forbidden range/);
    await expect(assertSafePublicUrl("http://10.0.0.1")).rejects.toThrow(/forbidden range/);
  });

  it("rejects known metadata hostnames", async () => {
    await expect(assertSafePublicUrl("http://metadata.google.internal/")).rejects.toThrow(/metadata endpoint/);
  });

  it("rejects localhost (DNS resolves to 127.0.0.1)", async () => {
    await expect(assertSafePublicUrl("http://localhost/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("accepts a public hostname", async () => {
    // example.com resolves to public IPs; this requires network. Skip if offline.
    try {
      await assertSafePublicUrl("https://example.com/");
    } catch (err) {
      if (err instanceof UnsafeUrlError && /DNS lookup failed/.test(err.message)) {
        // Offline test environment — treat as skipped.
        return;
      }
      throw err;
    }
  });
});
