import {
  assertLocalTargets,
  databaseNameFromUrl,
  dropAndRecreateSchema,
  ensureDatabase,
  migrateDeploy,
} from "../tools/database";
import { createPrisma, createStorageFromEnv, fail, loadEnv, print, storageTargets } from "./context";
import { printSeedReport } from "./report";
import { runSeed } from "./run";

// `npm run db:reset`: drop the `public` schema, apply the committed migrations, empty the bucket and seed (DB-022).
// It deliberately does NOT use `prisma migrate reset` (Prisma blocks that for AI agents and the guard is respected).
// The database itself is created first if it does not exist (ensureDatabase), so a PostgreSQL superuser URL in `.env`
// is all the setup needed. It is destructive, so it refuses unless the database (and the storage endpoint) are local,
// or --force is passed.

async function main() {
  const env = loadEnv();
  const force = process.argv.includes("--force");
  assertLocalTargets(
    { DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL, ...storageTargets(env) },
    force,
    "reset",
  );

  const database = databaseNameFromUrl(env.DIRECT_URL);
  const storage = createStorageFromEnv(env);
  print(`Resetting database "${database}" and storage "${storage.bucket}"...`);

  const created = await ensureDatabase(env.DIRECT_URL, (url) =>
    assertLocalTargets({ DIRECT_URL: url }, force, "create the database"),
  );
  if (created) print(`  created the database "${database}"`);
  print("  dropping the public schema");
  await dropAndRecreateSchema(env.DIRECT_URL, (url) =>
    assertLocalTargets({ DIRECT_URL: url }, force, "drop the schema"),
  );
  print("  applying migrations (prisma migrate deploy)");
  migrateDeploy(env.DIRECT_URL);

  const prisma = createPrisma(env.DATABASE_URL);
  try {
    print("  seeding");
    const result = await runSeed({
      prisma,
      storage,
      log: (message) => print(`    ${message}`),
    });
    printSeedReport(result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(fail);
