import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { MockProvider } from "../providers/mock.js";

describe("MockProvider", () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider({
      responses: ['{"valid": true}', '{"valid": false}'],
      structuredResponses: [
        { name: "test", value: 42 },
        { name: "second", value: 99 },
      ],
    });
  });

  describe("chat", () => {
    it("returns configured responses in order", async () => {
      const r1 = await provider.chat({
        model: "mock-model",
        messages: [{ role: "user", content: "hello" }],
      });
      expect(r1.content).toBe('{"valid": true}');

      const r2 = await provider.chat({
        model: "mock-model",
        messages: [{ role: "user", content: "world" }],
      });
      expect(r2.content).toBe('{"valid": false}');
    });

    it("records calls", async () => {
      await provider.chat({
        model: "mock-model",
        messages: [{ role: "user", content: "test" }],
      });

      expect(provider.getCallCount()).toBe(1);
      expect(provider.getCalls()[0].method).toBe("chat");
    });

    it("wraps around responses", async () => {
      await provider.chat({ model: "m", messages: [{ role: "user", content: "1" }] });
      await provider.chat({ model: "m", messages: [{ role: "user", content: "2" }] });
      const r3 = await provider.chat({ model: "m", messages: [{ role: "user", content: "3" }] });
      expect(r3.content).toBe('{"valid": true}'); // wraps back to first
    });
  });

  describe("structuredOutput", () => {
    it("returns validated data", async () => {
      const schema = z.object({ name: z.string(), value: z.number() });
      const result = await provider.structuredOutput({
        model: "mock-model",
        messages: [{ role: "user", content: "get data" }],
        schema,
      });

      expect(result.data).toEqual({ name: "test", value: 42 });
    });

    it("throws when no structured responses configured", async () => {
      const emptyProvider = new MockProvider({});
      const schema = z.object({ x: z.number() });

      await expect(
        emptyProvider.structuredOutput({
          model: "mock-model",
          messages: [{ role: "user", content: "test" }],
          schema,
        })
      ).rejects.toThrow("No structured response configured");
    });

    it("throws when response doesn't match schema", async () => {
      const badProvider = new MockProvider({
        structuredResponses: [{ wrong: "shape" }],
      });
      const schema = z.object({ required: z.number() });

      await expect(
        badProvider.structuredOutput({
          model: "mock-model",
          messages: [{ role: "user", content: "test" }],
          schema,
        })
      ).rejects.toThrow();
    });
  });

  describe("chatStream", () => {
    it("yields chunks", async () => {
      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({
        model: "mock-model",
        messages: [{ role: "user", content: "stream" }],
      })) {
        if (chunk.content) chunks.push(chunk.content);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("reset", () => {
    it("clears call history", async () => {
      await provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] });
      expect(provider.getCallCount()).toBe(1);
      provider.reset();
      expect(provider.getCallCount()).toBe(0);
    });
  });
});
