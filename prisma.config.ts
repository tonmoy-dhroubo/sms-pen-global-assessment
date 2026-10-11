import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI configuration (DB-008): the schema, migrations and seed live in `db/`.
// The CLI does not load `.env` by itself in Prisma 7, hence the `dotenv/config` import above.
//
// The URL is read without `env()` on purpose: `env()` throws when the variable is missing, and
// `prisma generate` / `prisma validate` (CI, `npm install`) must work on a machine with no `.env`.
// Commands that really connect (migrate, studio) fail with Prisma's own "datasource url" error instead.
export default defineConfig({
  schema: "db/schema.prisma",
  migrations: {
    path: "db/migrations",
    seed: "tsx db/seed/index.ts",
  },
  datasource: {
    // Migrations use the direct (non-pooled) connection; locally it equals DATABASE_URL.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});
