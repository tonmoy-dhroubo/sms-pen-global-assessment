import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertHasTables,
  assertLocalTargets,
  databaseNameFromUrl,
  ensureDatabase,
  withClient,
  withDatabase,
} from "@/db/tools/database";
import { assertTestDatabase, testDatabaseUrl } from "@/tests/support/test-db";

// ensureDatabase against the real PostgreSQL behind TEST_DATABASE_URL. It creates scratch databases next to the test
// database (same server and credentials) and drops them again.

const admin = () => withDatabase(testDatabaseUrl(), "postgres");
const scratchName = () => `sms_ensure_${randomBytes(4).toString("hex")}_test`;
const created: string[] = [];

async function databaseExists(name: string): Promise<boolean> {
  return withClient(admin(), async (client) => {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    return rowCount === 1;
  });
}

afterAll(async () => {
  await withClient(admin(), async (client) => {
    for (const name of created) await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
});

describe("ensureDatabase (real PostgreSQL)", () => {
  it("creates the database when it is missing, and is a no-op the second time", async () => {
    const name = scratchName();
    created.push(name);
    const url = withDatabase(testDatabaseUrl(), name);
    expect(await databaseExists(name)).toBe(false);

    expect(await ensureDatabase(url, assertTestDatabase)).toBe(true);
    expect(await databaseExists(name)).toBe(true);
    // The new database accepts connections.
    await withClient(url, async (client) => {
      await client.query("SELECT 1");
    });

    expect(await ensureDatabase(url, assertTestDatabase)).toBe(false); // already there: no error
    expect(await databaseExists(name)).toBe(true);
  });

  it("leaves an existing database and its data alone", async () => {
    const name = scratchName();
    created.push(name);
    const url = withDatabase(testDatabaseUrl(), name);
    await ensureDatabase(url, assertTestDatabase);
    await withClient(url, async (client) => {
      await client.query("CREATE TABLE keep_me (id int)");
      await client.query("INSERT INTO keep_me VALUES (1)");
    });

    await ensureDatabase(url, assertTestDatabase);
    const rows = await withClient(url, async (client) => (await client.query("SELECT id FROM keep_me")).rows);
    expect(rows).toEqual([{ id: 1 }]);
  });

  it("works for the configured test database", async () => {
    const url = testDatabaseUrl();
    await ensureDatabase(url, assertTestDatabase);
    expect(await databaseExists(databaseNameFromUrl(url))).toBe(true);
  });
  it("assertHasTables: fails on an empty database, passes once there is a table", async () => {
    const name = scratchName();
    created.push(name);
    const url = withDatabase(testDatabaseUrl(), name);
    await ensureDatabase(url, assertTestDatabase);

    await expect(assertHasTables(url)).rejects.toThrow(/no tables yet.*npm run db:reset/);
    await withClient(url, async (client) => {
      await client.query("CREATE TABLE some_table (id int)");
    });
    await expect(assertHasTables(url)).resolves.toBeUndefined();
  });

  it("creates nothing when the guard refuses", async () => {
    const name = "sms_guard_refused_test";
    const url = withDatabase(testDatabaseUrl(), name);
    const guard = () => {
      throw new Error("not allowed");
    };
    await expect(ensureDatabase(url, guard)).rejects.toThrow("not allowed");
    expect(await databaseExists(name)).toBe(false);
  });

  it("applies the test-name guard: a database not ending in _test is not created", async () => {
    const name = `sms_ensure_${randomBytes(4).toString("hex")}`;
    created.push(name); // dropped by afterAll if the guard ever fails to stop it
    await expect(ensureDatabase(withDatabase(testDatabaseUrl(), name), assertTestDatabase)).rejects.toThrow(
      /must end with "_test"/,
    );
    expect(await databaseExists(name)).toBe(false);
  });

  it("applies the local-only guard to a non-local URL", async () => {
    const guard = (url: string) => assertLocalTargets({ DIRECT_URL: url }, false, "create the database");
    await expect(
      ensureDatabase("postgresql://u:secret@db.example.com:5432/sms", guard),
    ).rejects.toThrow(/not local/);
  });

  it("refuses an unsafe name before touching the server", async () => {
    const url = withDatabase(testDatabaseUrl(), 'x"; DROP DATABASE postgres; --_test');
    await expect(ensureDatabase(url, () => undefined)).rejects.toThrow(/Refusing to create the database/);
  });
});
