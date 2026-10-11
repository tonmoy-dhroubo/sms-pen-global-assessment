import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests: real Postgres (TEST_DATABASE_URL, the `sms_test` database), real Prisma client, Route Handlers
// called directly with `Request` objects. Kept apart from the unit suite so `npm test` needs no services.
//   - globalSetup  drops and re-creates the schema, then applies the migrations (once per run).
//   - setupFiles   points the app's env at the test database and truncates every table before each test.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // `server-only` throws outside Next.js's server bundle; in tests we are on the server, so make it a no-op.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    setupFiles: ["tests/support/setup.ts"],
    // One shared database: run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
