import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests run in the Node environment (services and domain rules).
// A component test that needs the DOM opts in per file with `// @vitest-environment jsdom`.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // M04 acceptance: the pure domain rules are covered at 95% or better (lines and branches).
      // `types.ts` only holds type declarations, so there is nothing to execute.
      include: ["lib/services/rules/**/*.ts"],
      exclude: ["lib/services/rules/types.ts"],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
