import { NotFoundError } from "@/lib/api/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from a URL may be anything; a malformed one is simply a record that does not exist (api.md "Students"). */
export function assertKnownId(id: string, what: string): void {
  if (!UUID_PATTERN.test(id)) throw new NotFoundError(`${what} not found.`);
}

/** A calendar date for a Postgres `date` column: midnight UTC of that day. */
export function dateColumn(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
