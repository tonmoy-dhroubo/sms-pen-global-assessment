import path from "node:path";
import { defineConfig } from "vitest/config";

// Database tests: run against a real Postgres (TEST_DATABASE_URL, e.g. the `sms_test` database from
// docker-compose). Kept apart from the unit suite so `npm test` needs no services.
// M05 generalises this into the `test:integration` harness.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    // One shared database: run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
