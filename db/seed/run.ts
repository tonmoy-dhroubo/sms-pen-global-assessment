import type { PrismaClient } from "@/lib/generated/prisma/client";
import { type Clock, systemClock } from "@/lib/services/clock";
import type { Storage } from "@/lib/storage-core";
import { buildSeed, type BuildSummary } from "./build";
import { selfCheck, type SelfCheckResult } from "./check";
import { loadFixtures } from "./fixtures";
import { createRng } from "./rng";
import { createTimeline } from "./timeline";

// The seed as a function, so the CLI (index.ts, reset.ts) and the integration tests run exactly the same code.

export interface SeedOptions {
  prisma: PrismaClient;
  storage: Storage;
  /** The seed moment `T` comes from here (default: the real clock), so tests can pin it. */
  clock?: Clock;
  log?: (message: string) => void;
}

export interface SeedResult extends SelfCheckResult {
  summary: BuildSummary;
  /** The moment the data is relative to. */
  seedMoment: Date;
}

/** Seeds an empty database and an emptied bucket, then runs the self-check. Throws `SeedCheckError` on a mismatch. */
export async function runSeed(options: SeedOptions): Promise<SeedResult> {
  const { prisma, storage } = options;
  const log = options.log ?? (() => {});
  const seedMoment = (options.clock ?? systemClock)();
  const timeline = createTimeline(seedMoment);

  const existing =
    (await prisma.programme.count()) + (await prisma.staff.count()) + (await prisma.student.count());
  if (existing > 0) {
    throw new Error(
      "The database already has data. The seed only fills an empty database: run `npm run db:reset` to start over.",
    );
  }

  // Seed-plan rule 4: the submissions bucket is emptied and refilled together with the database.
  await storage.ensureBucket();
  const removed = await storage.deletePrefix("");
  log(`bucket "${storage.bucket}": emptied (${removed} object${removed === 1 ? "" : "s"} removed)`);

  const summary = await buildSeed({
    prisma,
    storage,
    timeline,
    rng: createRng(),
    fixtures: loadFixtures(),
    log,
  });
  const check = await selfCheck({ prisma, storage, timeline });
  return { ...check, summary, seedMoment };
}
