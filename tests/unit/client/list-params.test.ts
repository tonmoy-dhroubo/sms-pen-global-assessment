import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  formatSort,
  pageCount,
  parseListParams,
  parseSort,
  toQueryString,
  withParams,
} from "@/lib/list-params";

describe("parseListParams", () => {
  it("uses the api.md defaults when nothing is given", () => {
    expect(parseListParams(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sort: null,
    });
    expect(parseListParams(undefined)).toEqual({ page: 1, pageSize: 25, sort: null });
  });

  it("reads page, pageSize and sort from URLSearchParams", () => {
    expect(parseListParams(new URLSearchParams("page=3&pageSize=50&sort=-fullName"))).toEqual({
      page: 3,
      pageSize: 50,
      sort: { field: "fullName", direction: "desc" },
    });
  });

  it("reads Next.js searchParams objects, taking the first of repeated values", () => {
    expect(parseListParams({ page: ["2", "9"], pageSize: "100", sort: "studentNumber" })).toEqual({
      page: 2,
      pageSize: 100,
      sort: { field: "studentNumber", direction: "asc" },
    });
  });

  it("caps the page size at the maximum", () => {
    expect(parseListParams({ pageSize: "5000" }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it.each(["0", "-1", "abc", "1.5", "", "99999999999999999999"])(
    "ignores a malformed page or page size (%j)",
    (value) => {
      expect(parseListParams({ page: value, pageSize: value })).toMatchObject({
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
      });
    },
  );
});

describe("sort", () => {
  it("parses ascending and descending", () => {
    expect(parseSort("name")).toEqual({ field: "name", direction: "asc" });
    expect(parseSort("-name")).toEqual({ field: "name", direction: "desc" });
    expect(parseSort("student.name")).toEqual({ field: "student.name", direction: "asc" });
  });

  it.each([null, undefined, "", "  ", "-", "1abc", "a b", "a;drop"])("rejects %j", (value) => {
    expect(parseSort(value)).toBeNull();
  });

  it("round-trips through formatSort", () => {
    expect(formatSort({ field: "name", direction: "desc" })).toBe("-name");
    expect(formatSort({ field: "name", direction: "asc" })).toBe("name");
    expect(formatSort(null)).toBeNull();
  });
});

describe("withParams", () => {
  it("sets, replaces and removes keys without touching the others", () => {
    const next = withParams("q=anika&status=ENROLLED&page=3", {
      q: "arif",
      status: null,
      sort: "-fullName",
    });
    expect(next.toString()).toBe("q=arif&page=3&sort=-fullName");
  });

  it("drops defaults so URLs stay short", () => {
    expect(
      withParams("page=4&pageSize=50", { page: 1, pageSize: DEFAULT_PAGE_SIZE }).toString(),
    ).toBe("");
  });

  it("removes empty strings and undefined values", () => {
    expect(withParams("a=1&b=2", { a: "", b: undefined }).toString()).toBe("");
  });

  it("accepts URLSearchParams as the source and does not mutate it", () => {
    const source = new URLSearchParams("a=1");
    expect(withParams(source, { b: 2 }).toString()).toBe("a=1&b=2");
    expect(source.toString()).toBe("a=1");
  });
});

describe("toQueryString and pageCount", () => {
  it("prefixes a non-empty query string only", () => {
    expect(toQueryString(new URLSearchParams("a=1"))).toBe("?a=1");
    expect(toQueryString(new URLSearchParams())).toBe("");
  });

  it.each([
    [0, 25, 1],
    [1, 25, 1],
    [25, 25, 1],
    [26, 25, 2],
    [142, 25, 6],
    [100, 100, 1],
  ])("%i rows at %i per page is %i page(s)", (total, size, pages) => {
    expect(pageCount(total, size)).toBe(pages);
  });
});
