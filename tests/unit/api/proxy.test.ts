import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { SESSION_COOKIE_NAME, signSessionCookie } from "@/lib/session-cookie";

const SECRET = "unit-test-secret-that-is-at-least-32-chars";
const OTHER_SECRET = "another-secret-that-is-also-at-least-32-chars";
const ID = "7d9c7f4e-5b7a-4f0e-9a41-0f6a5a1d2c11";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {},
  });
}

const cookieFor = (role: "staff" | "student") => signSessionCookie({ role, id: ID }, SECRET);

/** `NextResponse.next()` marks itself with this header; a redirect has a Location instead. */
const passesThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";
const redirectsToRoot = (response: Response) =>
  response.status === 307 && new URL(response.headers.get("location")!).pathname === "/";

describe("proxy", () => {
  beforeEach(() => vi.stubEnv("SESSION_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it.each(["/staff", "/staff/students", "/staff/students/123/fees"])(
    "lets staff into %s",
    (path) => {
      expect(passesThrough(proxy(request(path, cookieFor("staff"))))).toBe(true);
    },
  );

  it.each(["/student", "/student/fees"])("lets a student into %s", (path) => {
    expect(passesThrough(proxy(request(path, cookieFor("student"))))).toBe(true);
  });

  it("sends visitors without a cookie back to the role picker", () => {
    expect(redirectsToRoot(proxy(request("/staff")))).toBe(true);
    expect(redirectsToRoot(proxy(request("/student/fees")))).toBe(true);
  });

  it("sends a student away from staff pages and staff away from student pages", () => {
    expect(redirectsToRoot(proxy(request("/staff/students", cookieFor("student"))))).toBe(true);
    expect(redirectsToRoot(proxy(request("/student", cookieFor("staff"))))).toBe(true);
  });

  it("rejects a tampered or foreign-signed cookie", () => {
    const valid = cookieFor("staff");
    const tampered = valid.slice(0, -2) + (valid.endsWith("AA") ? "BB" : "AA");
    expect(redirectsToRoot(proxy(request("/staff", tampered)))).toBe(true);
    const foreign = signSessionCookie({ role: "staff", id: ID }, OTHER_SECRET);
    expect(redirectsToRoot(proxy(request("/staff", foreign)))).toBe(true);
  });

  it("rejects an expired cookie", () => {
    const old = signSessionCookie(
      { role: "staff", id: ID },
      SECRET,
      new Date("2020-01-01T00:00:00Z"),
    );
    expect(redirectsToRoot(proxy(request("/staff", old)))).toBe(true);
  });

  it("refuses everyone when no secret is configured", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(redirectsToRoot(proxy(request("/staff", cookieFor("staff"))))).toBe(true);
  });

  it("does not interfere with other paths", () => {
    expect(passesThrough(proxy(request("/")))).toBe(true);
    expect(passesThrough(proxy(request("/students")))).toBe(true);
  });
});
