import { afterEach, describe, expect, it, vi } from "vitest";
import { dropAndRecreateSchema, testDatabaseUrl } from "../../support/test-db";

// The integration harness drops the whole schema, so its guard is tested here (no database needed): it must refuse
// anything that is not clearly a throw-away `_test` database (DB-022).

afterEach(() => vi.unstubAllEnvs());

describe("testDatabaseUrl", () => {
  it("accepts a database whose name ends in _test", () => {
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://sms:sms@localhost:5432/sms_test");
    expect(testDatabaseUrl()).toBe("postgresql://sms:sms@localhost:5432/sms_test");
  });

  it.each([
    "postgresql://sms:sms@localhost:5432/sms",
    "postgresql://sms:sms@localhost:5432/sms_test_backup",
    "postgresql://sms:sms@localhost:5432/test",
    "postgresql://sms:sms@localhost:5432/",
    "postgresql://sms:sms@prod.example.com:5432/neondb",
  ])("refuses %s", (url) => {
    vi.stubEnv("TEST_DATABASE_URL", url);
    expect(() => testDatabaseUrl()).toThrow(/must end with "_test"/);
  });

  it("refuses when TEST_DATABASE_URL is not set", () => {
    vi.stubEnv("TEST_DATABASE_URL", "");
    expect(() => testDatabaseUrl()).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it("dropAndRecreateSchema checks the URL it is given, whatever the environment says", async () => {
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://sms:sms@localhost:5432/sms_test");
    await expect(dropAndRecreateSchema("postgresql://sms:sms@localhost:5432/sms")).rejects.toThrow(
      /must end with "_test"/,
    );
  });
});
