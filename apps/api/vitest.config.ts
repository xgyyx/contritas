import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
