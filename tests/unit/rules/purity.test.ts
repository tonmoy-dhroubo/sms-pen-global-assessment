import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The domain rules are pure (M04): no database, no HTTP, no environment, no reading the clock. Guard that here so a
// later change cannot quietly break it.
const RULES_DIR = path.resolve(import.meta.dirname, "../../../lib/services/rules");

const FORBIDDEN: [string, RegExp][] = [
  [
    "the Prisma client or lib/db",
    /@prisma\/|generated\/prisma|@\/lib\/db|from ["']\.\.?\/.*\bdb["']/,
  ],
  ["process.env", /process\.env/],
  ["Date.now()", /Date\.now\(/],
  ["new Date() with no argument", /new Date\(\s*\)/],
  ["fetch / network", /\bfetch\(|node:http|node:net/],
  ["server-only modules", /server-only|next\/(headers|server)/],
];

/** Source with comments removed, so documentation can mention the things the rules must not do. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const files = readdirSync(RULES_DIR).filter((name) => name.endsWith(".ts"));

describe("lib/services/rules stays pure", () => {
  it("finds the rule modules", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "deadlines.ts",
        "duplicates.ts",
        "fees.ts",
        "marks.ts",
        "money.ts",
        "publish.ts",
        "status.ts",
        "student-number.ts",
        "submission-rules.ts",
        "time.ts",
      ]),
    );
  });

  for (const file of files) {
    it(`${file} has no impure dependencies`, () => {
      const code = stripComments(readFileSync(path.join(RULES_DIR, file), "utf8"));
      for (const [label, pattern] of FORBIDDEN) {
        expect(pattern.test(code), `${file} must not use ${label}`).toBe(false);
      }
    });
  }
});
