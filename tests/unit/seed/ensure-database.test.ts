import { describe, expect, it } from "vitest";
import {
  assertLocalTargets,
  databaseNameFromUrl,
  ensureDatabase,
  withDatabase,
} from "@/db/tools/database";

// `ensureDatabase` creates the target database for `db:reset` / `db:seed` / the test harness. These tests cover what
// happens before any connection is made (name parsing, name validation, the guard); creating and detecting a real
// database is in tests/integration/db/ensure-database.test.ts.

const allowAll = () => undefined;

describe("databaseNameFromUrl / withDatabase", () => {
  it("reads the database name from the URL path", () => {
    expect(databaseNameFromUrl("postgresql://postgres:secret@localhost:5432/sms")).toBe("sms");
    expect(databaseNameFromUrl("postgresql://u:p@localhost/sms_test?sslmode=disable")).toBe(
      "sms_test",
    );
  });

  it("points the same server and credentials at another database", () => {
    expect(
      withDatabase("postgresql://postgres:secret@localhost:5432/sms?sslmode=disable", "postgres"),
    ).toBe("postgresql://postgres:secret@localhost:5432/postgres?sslmode=disable");
  });
});

describe("ensureDatabase refusals", () => {
  it.each([
    'sms"; DROP DATABASE postgres; --',
    "sms db",
    "sms.test",
    "1sms",
    "sms;x",
    "s%C3%A9ms", // "séms": non-ASCII
    "a".repeat(64),
  ])("refuses the database name %s without connecting", async (name) => {
    const url = `postgresql://postgres:secret@localhost:1/${name}`; // port 1: any connection attempt would fail differently
    await expect(ensureDatabase(url, allowAll)).rejects.toThrow(/Refusing to create the database/);
  });

  it("runs the guard first and lets its error through", async () => {
    const guard = () => {
      throw new Error("guard says no");
    };
    await expect(
      ensureDatabase("postgresql://postgres:secret@localhost:1/sms", guard),
    ).rejects.toThrow("guard says no");
  });

  it("is refused for a non-local server with the local-only guard unless forced", async () => {
    const url = "postgresql://u:secret@ep-cool-name-123.neon.tech/neondb";
    const localOnly = (target: string) =>
      assertLocalTargets({ DIRECT_URL: target }, false, "create the database");
    await expect(ensureDatabase(url, localOnly)).rejects.toThrow(
      /Refusing to create the database: DIRECT_URL/,
    );
  });

  it("fails with a clear message when the server cannot be reached", async () => {
    await expect(
      ensureDatabase("postgresql://postgres:secret@127.0.0.1:1/sms", allowAll),
    ).rejects.toThrow(/does not exist or cannot be reached[\s\S]*Create it yourself/);
  });
});
