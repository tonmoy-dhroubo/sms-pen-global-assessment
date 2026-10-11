import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { env } from "./env";

// Prisma client singleton. In development Next.js hot reload re-evaluates modules, which would open a new
// connection pool on every edit, so the instance is cached on `globalThis` (dev only).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // Prisma 7 talks to Postgres through the `pg` driver adapter. App traffic uses DATABASE_URL (pooled when
  // hosted); migrations use DIRECT_URL (see prisma.config.ts).
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
