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
  },
});
