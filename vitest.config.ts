import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      thresholds: {
        statements: 85,
        branches: 82,
        functions: 88,
        lines: 85,
      },
    },
  },
  bench: {
    include: ["tests/**/*.bench.ts"],
  },
});
