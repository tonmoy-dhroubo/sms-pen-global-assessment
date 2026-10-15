import { assertLocalTargets, ensureDatabase } from "../tools/database";
import { createPrisma, createStorageFromEnv, fail, loadEnv, print, storageTargets } from "./context";
import { printSeedReport } from "./report";
import { runSeed } from "./run";

// `npm run db:seed` (and `prisma db seed`): fills an EMPTY database with the demo data in db/seed-plan.md, empties and
// refills the submissions bucket, and verifies the result with the real rule functions. It refuses a database that
// already has data (use `npm run db:reset` for a clean start) and, like the reset, anything that is not local unless
// --force is given, because it empties the bucket.

async function main() {
  const env = loadEnv();
  const force = process.argv.includes("--force");
  assertLocalTargets(
    { DATABASE_URL: env.DATABASE_URL, ...storageTargets(env) },
    force,
    "seed (it empties the submissions bucket)",
  );

  await ensureDatabase(env.DATABASE_URL, (url) =>
    assertLocalTargets({ DATABASE_URL: url }, force, "create the database"),
  );

  const prisma = createPrisma(env.DATABASE_URL);
  try {
    print("Seeding the demo data...");
    const result = await runSeed({
      prisma,
      storage: createStorageFromEnv(env),
      log: (message) => print(`  ${message}`),
    });
    printSeedReport(result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(fail);
