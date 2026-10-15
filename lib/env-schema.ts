import { z } from "zod";

// Pure environment parsing: no `process.env` access, no `server-only`, so it is unit-testable.
// The app reads the validated result from `lib/env.ts`.

const nonEmpty = z.string().min(1, "must not be empty");

const postgresUrl = z
  .string()
  .url("must be a valid URL")
  .refine((value) => /^postgres(ql)?:\/\//.test(value), "must start with postgresql://");

const httpUrl = z
  .string()
  .url("must be a valid URL")
  .refine((value) => /^https?:\/\//.test(value), "must start with http:// or https://");

const booleanString = z.enum(["true", "false"], {
  errorMap: () => ({ message: 'must be "true" or "false"' }),
});

const timeZone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'must be an IANA time zone such as "Asia/Dhaka"');

const schema = z.object({
  // Database
  DATABASE_URL: postgresUrl,
  // Migrations connection; falls back to DATABASE_URL (they are the same locally).
  DIRECT_URL: postgresUrl.optional(),
  // Integration-test database; only needed locally and in CI.
  TEST_DATABASE_URL: postgresUrl.optional(),

  // File storage (D-045). `s3` (MinIO locally, Supabase when hosted) or `filesystem` (a directory; no Docker needed).
  STORAGE_DRIVER: z
    .enum(["s3", "filesystem"], {
      errorMap: () => ({ message: 'must be "s3" or "filesystem"' }),
    })
    .default("s3"),
  // Where the filesystem driver keeps files (relative paths are from the project root).
  FILE_STORAGE_DIR: nonEmpty.default("./storage"),
  // The S3_* variables are required only when STORAGE_DRIVER is `s3` (checked in `parseEnv`).
  S3_ENDPOINT: httpUrl.optional(),
  S3_PUBLIC_ENDPOINT: httpUrl.optional(),
  S3_REGION: nonEmpty.optional(),
  S3_BUCKET: nonEmpty.optional(),
  S3_ACCESS_KEY_ID: nonEmpty.optional(),
  S3_SECRET_ACCESS_KEY: nonEmpty.optional(),
  S3_FORCE_PATH_STYLE: booleanString.default("true").transform((value) => value === "true"),

  // Application
  APP_TIMEZONE: timeZone.default("Asia/Dhaka"),
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
  MAX_UPLOAD_MB: z.coerce
    .number({ invalid_type_error: "must be a number" })
    .int("must be a whole number")
    .positive("must be greater than 0")
    .default(20),
  DEMO_MODE: booleanString.default("false").transform((value) => value === "true"),
});

type Parsed = z.infer<typeof schema>;

/** The variables the `s3` driver cannot run without. */
const S3_REQUIRED = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;
type S3Required = (typeof S3_REQUIRED)[number];

/**
 * The validated environment. With `STORAGE_DRIVER=s3` the S3_* variables are strings; with `filesystem` they may be
 * absent. Check `STORAGE_DRIVER` to narrow.
 */
export type Env = Omit<Parsed, "DIRECT_URL" | "STORAGE_DRIVER" | S3Required> & {
  DIRECT_URL: string;
} & (
    | ({ STORAGE_DRIVER: "s3" } & { [K in S3Required]: string })
    | ({ STORAGE_DRIVER: "filesystem" } & { [K in S3Required]: string | undefined })
  );

/** Thrown when the environment is missing or invalid. `problems` has one readable line per variable. */
export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(
      [
        "Invalid environment variables:",
        ...problems.map((problem) => `  - ${problem}`),
        "",
        "Copy .env.example to .env and set the values listed above (see README: Run locally).",
      ].join("\n"),
    );
    this.name = "EnvError";
  }
}

type Source = Record<string, string | undefined>;

/** Validates a set of environment variables (usually `process.env`). Empty strings count as unset. */
export function parseEnv(source: Source): Env {
  const input = Object.fromEntries(
    Object.keys(schema.shape).map((key) => {
      const value = source[key];
      return [key, value === undefined || value.trim() === "" ? undefined : value.trim()];
    }),
  );

  const result = schema.safeParse(input);
  // One line per variable: the first problem found for it.
  const firstIssue = new Map<string, string>();
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "(unknown)");
      if (!firstIssue.has(key))
        firstIssue.set(key, input[key] === undefined ? "is missing" : issue.message);
    }
  }
  // Unless the filesystem driver is chosen, the S3 settings are required (an invalid driver value is reported above).
  if (input.STORAGE_DRIVER !== "filesystem") {
    for (const key of S3_REQUIRED) {
      if (input[key] === undefined && !firstIssue.has(key)) firstIssue.set(key, "is missing");
    }
  }
  if (!result.success || firstIssue.size > 0) {
    throw new EnvError([...firstIssue].map(([key, message]) => `${key}: ${message}`));
  }

  return {
    ...result.data,
    DIRECT_URL: result.data.DIRECT_URL ?? result.data.DATABASE_URL,
  } as Env;
}
