import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertLocalTargets, dropAndRecreateSchema, isLocalUrl } from "@/db/tools/database";

// db:reset and db:seed wipe data, so they must refuse anything that is not on this machine unless --force is given
// (M07, DB-022).

describe("isLocalUrl", () => {
  it.each([
    "postgresql://sms:sms@localhost:5432/sms",
    "postgresql://sms:sms@127.0.0.1:5432/sms",
    "postgresql://sms:sms@[::1]:5432/sms",
    "http://LOCALHOST:9000",
  ])("accepts %s", (url) => {
    expect(isLocalUrl(url)).toBe(true);
  });

  it.each([
    "postgresql://u:p@ep-cool-name-123.ap-southeast-1.aws.neon.tech/neondb",
    "postgresql://sms:sms@db.example.com:5432/sms",
    "postgresql://sms:sms@localhost.example.com:5432/sms",
    "postgresql://sms:sms@10.0.0.5:5432/sms",
    "https://abc.supabase.co/storage/v1/s3",
    "not a url",
  ])("refuses %s", (url) => {
    expect(isLocalUrl(url)).toBe(false);
  });
});

describe("assertLocalTargets", () => {
  it("passes when every target is local", () => {
    expect(() =>
      assertLocalTargets(
        {
          DATABASE_URL: "postgresql://sms:sms@localhost:5432/sms",
          S3_ENDPOINT: "http://localhost:9000",
        },
        false,
      ),
    ).not.toThrow();
  });

  it("names the remote target but never prints its password", () => {
    const remote = "postgresql://user:s3cret-pass@ep-1.neon.tech/neondb";
    expect(() =>
      assertLocalTargets(
        { DATABASE_URL: remote, S3_ENDPOINT: "http://localhost:9000" },
        false,
        "reset",
      ),
    ).toThrow(/Refusing to reset: DATABASE_URL \(ep-1\.neon\.tech\) is not local/);
    try {
      assertLocalTargets({ DATABASE_URL: remote }, false);
    } catch (error) {
      expect((error as Error).message).not.toContain("s3cret-pass");
    }
  });

  it("lets --force through", () => {
    expect(() =>
      assertLocalTargets({ DATABASE_URL: "postgresql://u:p@ep-1.neon.tech/neondb" }, true),
    ).not.toThrow();
  });

  it("is the guard that dropAndRecreateSchema runs first, before connecting", async () => {
    const remote = "postgresql://u:p@ep-1.neon.tech/neondb";
    await expect(
      dropAndRecreateSchema(remote, (url) =>
        assertLocalTargets({ DIRECT_URL: url }, false, "drop"),
      ),
    ).rejects.toThrow(/Refusing to drop/);
  });
});

describe("npm run db:reset", () => {
  it("refuses a hosted database before it touches anything", () => {
    const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
    const result = spawnSync(process.execPath, [tsx, "db/seed/reset.ts"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://u:p@ep-1.neon.tech/neondb",
        DIRECT_URL: "postgresql://u:p@ep-1.neon.tech/neondb",
        S3_ENDPOINT: "http://localhost:9000",
        S3_REGION: "us-east-1",
        S3_BUCKET: "submissions",
        S3_ACCESS_KEY_ID: "unit-test",
        S3_SECRET_ACCESS_KEY: "unit-test",
        SESSION_SECRET: "unit-test-session-secret-at-least-32-chars",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /Refusing to reset: DATABASE_URL \(ep-1\.neon\.tech\), DIRECT_URL/,
    );
    expect(result.stdout).not.toMatch(/dropping/);
  }, 30_000);
});
