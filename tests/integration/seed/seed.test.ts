import { describe, expect, it } from "vitest";
import { selfCheck, SeedCheckError } from "@/db/seed/check";
import { runSeed } from "@/db/seed/run";
import { createTimeline } from "@/db/seed/timeline";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/services/clock";
import { createStorage } from "@/lib/storage-core";
import { testDatabaseUrl, truncateAll, withClient } from "../../support/test-db";

// The whole seed against the real test database and the `submissions-test` bucket: it must pass its own self-check at
// any moment of the year (including the awkward ones), and two runs on the same day must produce the same content.

const storage = createStorage({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  forcePathStyle: true,
});

const seedAt = (iso: string) => runSeed({ prisma: db, storage, clock: fixedClock(iso) });
const wipeDatabase = () => withClient(testDatabaseUrl(), truncateAll);

const SLOW = 120_000;

describe("seed", () => {
  it(
    "builds the plan and passes its self-check",
    async () => {
      const result = await seedAt("2026-10-12T04:00:00Z"); // 10:00 in Dhaka
      expect(result.summary).toMatchObject({
        staff: 3,
        programmes: 3,
        modules: 8,
        assessments: 10,
        students: 30,
        submissions: 78,
        files: 80,
        marks: 54,
      });
      expect(result.lines.length).toBeGreaterThan(15);
      expect(result.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    },
    SLOW,
  );

  it(
    "gives identical content when it runs again on the same day, whatever the time",
    async () => {
      const first = await seedAt("2026-10-12T04:00:00Z"); // 10:00 Dhaka
      await wipeDatabase();
      const second = await seedAt("2026-10-12T10:30:00Z"); // 16:30 Dhaka
      expect(second.fingerprint).toBe(first.fingerprint);
    },
    SLOW,
  );

  it(
    "keeps its promises on dates where the arithmetic is awkward",
    async () => {
      const awkward = [
        "2026-10-11T18:30:00Z", // 00:30 in Dhaka: Lab Assignment 2's deadline is moved back so late files precede T
        "2026-06-30T17:59:00Z", // 23:59 on 30 June: last minute of session 2025-26
        "2026-06-30T18:00:00Z", // 00:00 on 1 July: first minute of session 2026-27
        "2027-01-03T06:00:00Z", // January: still session 2026-27
        "2028-02-29T06:00:00Z", // a leap day
      ];
      for (const moment of awkward) {
        await wipeDatabase();
        await expect(seedAt(moment), moment).resolves.toBeDefined();
      }
    },
    SLOW * 3,
  );

  it(
    "uploads real, differently-dated files for the late and resubmitted submissions",
    async () => {
      await seedAt("2026-10-12T04:00:00Z");
      const tahmid = await db.submissionFile.findMany({
        where: {
          submission: {
            student: { fullName: "Tahmid Chowdhury" },
            assessment: { title: "Essay 1" },
          },
        },
        orderBy: { uploadedAt: "asc" },
      });
      expect(tahmid).toHaveLength(2);
      expect(tahmid[0]!.sha256).not.toBe(tahmid[1]!.sha256);
      for (const file of tahmid) {
        const head = await storage.headObject(file.objectKey);
        expect(head?.sizeBytes).toBe(file.sizeBytes);
        const firstBytes = (await storage.readFirstBytes(file.objectKey, 4)).toString("latin1");
        expect(firstBytes).toBe(file.mimeType === "application/pdf" ? "%PDF" : "PK");
        expect(await storage.sha256(file.objectKey)).toBe(file.sha256);
      }
    },
    SLOW,
  );

  it("refuses to seed a database that already has data", async () => {
    await db.staff.create({ data: { fullName: "Existing", email: "x@x.test", jobTitle: "Clerk" } });
    await expect(seedAt("2026-10-12T04:00:00Z")).rejects.toThrow(/already has data/);
  });

  it(
    "fails loudly, diff-style, when the data no longer matches the plan",
    async () => {
      await seedAt("2026-10-12T04:00:00Z");
      // Take away Nusrat's credit by voiding her overpayment: the plan says exactly one student is in credit.
      const staff = await db.staff.findFirstOrThrow();
      await db.payment.updateMany({
        where: { student: { fullName: "Nusrat Jahan" }, amount: 165000 },
        data: { voidedAt: new Date(), voidedById: staff.id, voidReason: "tampered by the test" },
      });
      const error = await selfCheck({
        prisma: db,
        storage,
        timeline: createTimeline(new Date("2026-10-12T04:00:00Z")),
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SeedCheckError);
      const message = (error as SeedCheckError).message;
      expect(message).toMatch(/students in credit/);
      expect(message).toMatch(/^ {2}- /m);
      expect(message).toMatch(/^ {2}\+ /m);
      expect(message).toContain("Nusrat Jahan");
    },
    SLOW,
  );
});
