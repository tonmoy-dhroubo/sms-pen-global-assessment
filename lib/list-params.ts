// List query parameters shared by pages and the DataTable (api.md "Lists"): `page` (default 1), `pageSize` (default
// 25, max 100) and `sort` (`field`, or `-field` for descending). Pure and free of server imports so both server
// pages (reading `searchParams`) and client components (writing the URL) can use it.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export interface SortSpec {
  field: string;
  direction: "asc" | "desc";
}

export interface ListParams {
  page: number;
  pageSize: number;
  sort: SortSpec | null;
}

type SearchParamsInput =
  URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

function firstValue(input: SearchParamsInput, key: string): string | undefined {
  if (!input) return undefined;
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
  const value = input[key];
  return Array.isArray(value) ? value[0] : value;
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseSort(value: string | null | undefined): SortSpec | null {
  const text = value?.trim();
  if (!text) return null;
  const descending = text.startsWith("-");
  const field = descending ? text.slice(1) : text;
  if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(field)) return null;
  return { field, direction: descending ? "desc" : "asc" };
}

export function formatSort(sort: SortSpec | null | undefined): string | null {
  if (!sort) return null;
  return sort.direction === "desc" ? `-${sort.field}` : sort.field;
}

/** Reads `page`, `pageSize` and `sort`, falling back to the defaults for anything missing or malformed. */
export function parseListParams(input: SearchParamsInput): ListParams {
  const requestedSize = positiveInt(firstValue(input, "pageSize"));
  return {
    page: positiveInt(firstValue(input, "page")) ?? 1,
    pageSize: Math.min(requestedSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    sort: parseSort(firstValue(input, "sort")),
  };
}

export type ParamUpdates = Record<string, string | number | null | undefined>;

/**
 * A copy of `current` with `updates` applied: `null`, `undefined` and empty strings remove a key. Defaults are
 * dropped so URLs stay short (`page=1` and the default page size are never written).
 */
export function withParams(
  current: URLSearchParams | string,
  updates: ParamUpdates,
): URLSearchParams {
  const next = new URLSearchParams(typeof current === "string" ? current : current.toString());
  for (const [key, value] of Object.entries(updates)) {
    const text = value === null || value === undefined ? "" : String(value);
    const isDefault =
      (key === "page" && text === "1") ||
      (key === "pageSize" && text === String(DEFAULT_PAGE_SIZE));
    if (text === "" || isDefault) next.delete(key);
    else next.set(key, text);
  }
  return next;
}

/** `?a=b` (or an empty string) for appending to a path. */
export function toQueryString(params: URLSearchParams): string {
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Number of pages for `total` rows; at least 1 so an empty list still has "page 1 of 1". */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
