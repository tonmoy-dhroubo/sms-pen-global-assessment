// Plain types shared by the domain rules. They mirror the Prisma enums as string unions on purpose: the rules stay
// pure (no generated-client import, no runtime code), and Prisma's enum values are assignable to these unions.

export type EnrolmentStatus = "ENROLLED" | "DEFERRED" | "WITHDRAWN" | "COMPLETED";

export type FeeChargeKind = "PROGRAMME_FEE" | "ADJUSTMENT" | "WAIVER";

export type ReleaseStatus = "DRAFT" | "PUBLISHED" | "WITHHELD";

export type Classification = "FAIL" | "PASS" | "MERIT" | "DISTINCTION";

/** A calendar date with no time zone, as `YYYY-MM-DD` (the database `date` type, DB-006). */
export type DateOnly = string;
