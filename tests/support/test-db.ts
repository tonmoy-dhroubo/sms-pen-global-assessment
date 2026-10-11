import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";

// Database plumbing for the integration harness. Prisma 7 refuses `prisma migrate reset` when an AI agent runs it
// (DB-022) and that guard is respected: the schema is dropped and re-created here, then `prisma migrate deploy`
// applies the committed migrations.

/** Throws unless the URL's database name ends in `_test`; returns the URL. */
export function assertTestDatabase(url: string): string {
  const database = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!database.endsWith("_test")) {
    throw new Error(
      `Refusing to run against "${database}": the test database name must end with "_test".`,
    );
  }
  return url;
}

/** Reads TEST_DATABASE_URL and refuses anything whose database name does not end in `_test`. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  return assertTestDatabase(url);
}

async function withClient<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Drops everything in the `public` schema (tables, enums, functions, extensions) and creates it again. */
export async function dropAndRecreateSchema(url: string = testDatabaseUrl()): Promise<void> {
  assertTestDatabase(url); // guard whatever URL was passed in
  await withClient(url, async (client) => {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  });
}

/** Applies the committed migrations with the Prisma CLI (no shell, so it behaves the same on every OS). */
export function migrateDeploy(url: string = testDatabaseUrl()): void {
  const prismaCli = path.resolve("node_modules/prisma/build/index.js");
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DIRECT_URL: url, DATABASE_URL: url },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/** Empties every application table (all of `public` except Prisma's own migration table). */
export async function truncateAll(client: Client): Promise<void> {
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"${row.tablename}"`).join(", ");
  await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

export { withClient };
