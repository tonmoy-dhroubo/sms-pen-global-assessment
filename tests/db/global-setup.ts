import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Brings the test database up to date with the committed migrations (`migrate deploy`: applies what is pending and
// never drops anything). Tests clean up after themselves by truncating tables.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");

  // Safety net: only ever touch a clearly named throw-away test database.
  const database = new URL(url).pathname.replace(/^\//, "");
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to run against "${database}": the test database name must end with "_test".`);
  }

  // Run the Prisma CLI with the current Node binary: no shell, so the same code works on every OS.
  const prismaCli = path.resolve("node_modules/prisma/build/index.js");
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DIRECT_URL: url, DATABASE_URL: url },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
}
