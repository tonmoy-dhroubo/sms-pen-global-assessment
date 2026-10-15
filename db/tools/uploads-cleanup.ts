import { assertLocalTargets } from "./database";
import { createPrisma, createStorageFromEnv, fail, loadEnv, print, storageTargets } from "../seed/context";
import { cleanupExpiredUploads } from "@/lib/services/upload-cleanup";

// `npm run uploads:cleanup`: delete expired, unconfirmed pending uploads and their stray objects (DB-017). It deletes
// objects, so like `db:reset` it refuses to run against a database or storage endpoint that is not on this machine
// unless --force is passed.

async function main() {
  const env = loadEnv();
  const force = process.argv.includes("--force");
  assertLocalTargets(
    { DATABASE_URL: env.DATABASE_URL, ...storageTargets(env) },
    force,
    "clean up uploads",
  );

  const prisma = createPrisma(env.DATABASE_URL);
  try {
    const storage = createStorageFromEnv(env);
    const report = await cleanupExpiredUploads({
      prisma,
      storage,
      now: new Date(),
    });
    print(
      report.expired === 0
        ? "No expired uploads to clean up."
        : `Cleaned up ${report.removed} of ${report.expired} expired uploads in storage "${storage.bucket}".`,
    );
    for (const failure of report.failed) {
      print(`  could not delete ${failure.objectKey}: ${failure.message}`);
    }
    if (report.failed.length > 0) {
      throw new Error(`${report.failed.length} object(s) could not be deleted; run it again.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(fail);
