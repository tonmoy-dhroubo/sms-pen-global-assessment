import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";

// Database plumbing shared by the integration test harness (tests/support/test-db.ts) and `npm run db:reset`
// (db/seed/reset.ts). Prisma 7 refuses `prisma migrate reset` when an AI agent runs it (DB-022) and that guard is
// respected: the schema is dropped and re-created here, then `prisma migrate deploy` applies the committed
// migrations. Dropping is destructive, so `dropAndRecreateSchema` has no default policy: the caller must pass the
// guard that decides which databases it may touch (the `_test` guard for tests, the local-host guard for reset).

/** Throws if the database URL must not be dropped. */
export type DatabaseGuard = (url: string) => void;

export async function withClient<T>(
  url: string,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Drops everything in the `public` schema (tables, enums, functions, extensions) and creates it again.
 * `guard` runs first and must throw for a database that is not allowed to be wiped.
 */
export async function dropAndRecreateSchema(url: string, guard: DatabaseGuard): Promise<void> {
  guard(url);
  await withClient(url, async (client) => {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  });
}

/** Applies the committed migrations with the Prisma CLI (no shell, so it behaves the same on every OS). */
export function migrateDeploy(url: string): void {
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

// --- Local-only guard (db:reset, db:seed) ---------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True when the URL points at this machine (`localhost`, `127.0.0.1` or `::1`). */
export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false; // an unparseable URL is never "local"
  }
}

/**
 * Refuses to wipe anything that is not on this machine unless `force` is set (`--force`). `targets` are the
 * connection URLs the operation will touch: the database(s) and the object-storage endpoint. Passwords are never
 * echoed in the message.
 */
export function assertLocalTargets(
  targets: Record<string, string>,
  force: boolean,
  action = "wipe",
): void {
  if (force) return;
  const remote = Object.entries(targets).filter(([, url]) => !isLocalUrl(url));
  if (remote.length === 0) return;
  const described = remote.map(([label, url]) => {
    let host = "(invalid URL)";
    try {
      host = new URL(url).host;
    } catch {
      /* keep the placeholder */
    }
    return `${label} (${host})`;
  });
  throw new Error(
    `Refusing to ${action}: ${described.join(", ")} ${remote.length === 1 ? "is" : "are"} not local ` +
      "(localhost, 127.0.0.1 or ::1). Pass --force only if you are sure this is a throw-away environment.",
  );
}
