import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      thresholds: {
        statements: 55,
        branches: 79,
        functions: 65,
        lines: 55,
      },
    },
  },
  bench: {
    include: ["tests/**/*.bench.ts"],
  },
});
