import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { TEST_SESSION_SECRET } from "./constants";
import { testDatabaseUrl, truncateAll } from "./test-db";
import { applyStorageTestEnv } from "./test-storage";

// Runs in every integration test file before the file's own code.
//
// 1. Point the app at the test database. `lib/env` reads these when it is first imported, so this must happen here
//    and not in a test. DATABASE_URL is overwritten on purpose: whatever .env says, tests never touch `sms`.
const url = testDatabaseUrl();
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;

// 2. A fixed secret so tests can sign their own cookies (see tests/support/api.ts).

process.env.SESSION_SECRET = TEST_SESSION_SECRET;

// 3. Point the app at the test bucket (never the dev one) and fill in local-MinIO defaults when .env is absent (as in
//    CI). The bucket itself is created and emptied once per run by global-setup.ts.
applyStorageTestEnv();

// 4. Empty every table before each test.
let client: Client;
beforeAll(async () => {
  client = new Client({ connectionString: url });
  await client.connect();
});
beforeEach(async () => {
  await truncateAll(client);
});
afterAll(async () => {
  await client.end();
});
