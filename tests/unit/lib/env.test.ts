import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/lib/env-schema";

// The parser takes the variables as an argument, so these tests never touch the real process.env.
const valid = {
  DATABASE_URL: "postgresql://sms:sms@localhost:5432/sms",
  DIRECT_URL: "postgresql://sms:sms@localhost:5432/sms",
  TEST_DATABASE_URL: "postgresql://sms:sms@localhost:5432/sms_test",
  S3_ENDPOINT: "http://localhost:9000",
  S3_PUBLIC_ENDPOINT: "",
  S3_REGION: "us-east-1",
  S3_BUCKET: "submissions",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  S3_FORCE_PATH_STYLE: "true",
  APP_TIMEZONE: "Asia/Dhaka",
  SESSION_SECRET: "x".repeat(32),
  MAX_UPLOAD_MB: "20",
  DEMO_MODE: "false",
};

function problemsFor(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("parses a complete environment into typed values", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.MAX_UPLOAD_MB).toBe(20);
    expect(env.DEMO_MODE).toBe(false);
    expect(env.APP_TIMEZONE).toBe("Asia/Dhaka");
  });

  it("treats empty optional values as unset", () => {
    expect(parseEnv(valid).S3_PUBLIC_ENDPOINT).toBeUndefined();
  });

  it("keeps S3_PUBLIC_ENDPOINT when set", () => {
    const env = parseEnv({ ...valid, S3_PUBLIC_ENDPOINT: "https://files.example.com" });
    expect(env.S3_PUBLIC_ENDPOINT).toBe("https://files.example.com");
  });

  it("applies defaults for optional settings", () => {
    const env = parseEnv({
      DATABASE_URL: valid.DATABASE_URL,
      S3_ENDPOINT: valid.S3_ENDPOINT,
      S3_REGION: valid.S3_REGION,
      S3_BUCKET: valid.S3_BUCKET,
      S3_ACCESS_KEY_ID: valid.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: valid.S3_SECRET_ACCESS_KEY,
      SESSION_SECRET: valid.SESSION_SECRET,
    });
    expect(env.APP_TIMEZONE).toBe("Asia/Dhaka");
    expect(env.MAX_UPLOAD_MB).toBe(20);
    expect(env.DEMO_MODE).toBe(false);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.TEST_DATABASE_URL).toBeUndefined();
  });

  it("falls back to DATABASE_URL when DIRECT_URL is not set", () => {
    const env = parseEnv({ ...valid, DIRECT_URL: undefined });
    expect(env.DIRECT_URL).toBe(valid.DATABASE_URL);
  });

  it("reads booleans and numbers from strings", () => {
    const env = parseEnv({
      ...valid,
      DEMO_MODE: "true",
      S3_FORCE_PATH_STYLE: "false",
      MAX_UPLOAD_MB: "5",
    });
    expect(env.DEMO_MODE).toBe(true);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(env.MAX_UPLOAD_MB).toBe(5);
  });

  it("lists every missing required variable", () => {
    const problems = problemsFor({});
    for (const key of [
      "DATABASE_URL",
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "SESSION_SECRET",
    ]) {
      expect(problems).toContain(`${key}: is missing`);
    }
    expect(problems.some((problem) => problem.startsWith("DIRECT_URL"))).toBe(false);
  });

  it("treats an empty or blank required value as missing", () => {
    expect(problemsFor({ ...valid, DATABASE_URL: "" })).toEqual(["DATABASE_URL: is missing"]);
    expect(problemsFor({ ...valid, S3_BUCKET: "   " })).toEqual(["S3_BUCKET: is missing"]);
  });

  it("rejects invalid values with a readable reason", () => {
    const problems = problemsFor({
      ...valid,
      DATABASE_URL: "mysql://localhost/sms",
      S3_ENDPOINT: "not a url",
      APP_TIMEZONE: "Mars/Olympus",
      SESSION_SECRET: "too-short",
      MAX_UPLOAD_MB: "0",
      DEMO_MODE: "yes",
    });
    expect(problems).toEqual([
      "DATABASE_URL: must start with postgresql://",
      "S3_ENDPOINT: must be a valid URL",
      'APP_TIMEZONE: must be an IANA time zone such as "Asia/Dhaka"',
      "SESSION_SECRET: must be at least 32 characters",
      "MAX_UPLOAD_MB: must be greater than 0",
      'DEMO_MODE: must be "true" or "false"',
    ]);
  });

  it("rejects a non-numeric or fractional upload limit", () => {
    expect(problemsFor({ ...valid, MAX_UPLOAD_MB: "lots" })).toEqual([
      "MAX_UPLOAD_MB: must be a number",
    ]);
    expect(problemsFor({ ...valid, MAX_UPLOAD_MB: "2.5" })).toEqual([
      "MAX_UPLOAD_MB: must be a whole number",
    ]);
  });

  it("builds an error message that names each problem and points at .env.example", () => {
    try {
      parseEnv({ ...valid, DATABASE_URL: undefined, SESSION_SECRET: "short" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as EnvError).message;
      expect(message).toContain("Invalid environment variables:");
      expect(message).toContain("  - DATABASE_URL: is missing");
      expect(message).toContain("  - SESSION_SECRET: must be at least 32 characters");
      expect(message).toContain(".env.example");
    }
  });
});
