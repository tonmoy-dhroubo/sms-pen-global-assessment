import "dotenv/config";
import {
  databaseNameFromUrl,
  dropAndRecreateSchema as dropSchema,
  ensureDatabase,
  migrateDeploy as migrate,
  truncateAll,
  withClient,
} from "@/db/tools/database";

// Database plumbing for the integration harness. The generic pieces live in db/tools/database.ts (shared with
// `npm run db:reset`); this file adds the strict test guard: the harness only ever touches a database whose name
// ends in `_test` (DB-022).

/** Throws unless the URL's database name ends in `_test`; returns the URL. */
export function assertTestDatabase(url: string): string {
  const database = databaseNameFromUrl(url);
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

/** Creates the test database if it does not exist yet; refuses a database not named `*_test`. */
export async function ensureTestDatabase(url: string = testDatabaseUrl()): Promise<void> {
  await ensureDatabase(url, assertTestDatabase);
}

/** Drops everything in the `public` schema and creates it again; refuses a database not named `*_test`. */
export async function dropAndRecreateSchema(url: string = testDatabaseUrl()): Promise<void> {
  await dropSchema(url, assertTestDatabase); // guard whatever URL was passed in
}

/** Applies the committed migrations with the Prisma CLI. */
export function migrateDeploy(url: string = testDatabaseUrl()): void {
  assertTestDatabase(url);
  migrate(url);
}

export { truncateAll, withClient };
