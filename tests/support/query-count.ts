import pg from "pg";

// Counts the SQL statements the app's own database client (the Prisma `pg` adapter) sends while a function runs, so a
// test can prove a page costs the same number of statements for 5 rows as for 50 (no per-row queries). It patches
// `pg.Client.prototype.query`, which every pooled connection uses, and ignores transaction control and session setup.

type QueryFn = (this: pg.Client, ...args: unknown[]) => unknown;

const CONTROL = /^\s*(begin|commit|rollback|savepoint|release|set |reset|deallocate|discard)/i;

export async function countStatements<T>(
  run: () => Promise<T>,
): Promise<{ result: T; statements: string[] }> {
  const statements: string[] = [];
  const original = pg.Client.prototype.query as unknown as QueryFn;
  (pg.Client.prototype as unknown as { query: QueryFn }).query = function (...args: unknown[]) {
    const first = args[0];
    const text =
      typeof first === "string" ? first : ((first as { text?: string } | undefined)?.text ?? "");
    if (text && !CONTROL.test(text)) statements.push(text);
    return original.apply(this, args);
  };
  try {
    const result = await run();
    return { result, statements };
  } finally {
    (pg.Client.prototype as unknown as { query: QueryFn }).query = original;
  }
}
