import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  buildClearSessionCookie,
  buildSessionSetCookie,
  readCookie,
  signSessionCookie,
  verifySessionCookie,
} from "@/lib/session-cookie";

const SECRET = "unit-test-secret-that-is-at-least-32-chars";
const OTHER_SECRET = "another-secret-that-is-also-at-least-32-chars";
const ID = "7d9c7f4e-5b7a-4f0e-9a41-0f6a5a1d2c11";
const NOW = new Date("2026-10-12T10:00:00Z");

/** Builds a cookie with an arbitrary payload and a *valid* signature, to test what is checked after the signature. */
function signedRaw(payload: string, secret = SECRET) {
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

describe("signSessionCookie / verifySessionCookie", () => {
  it("round-trips role, id and issued-at", () => {
    const value = signSessionCookie({ role: "student", id: ID }, SECRET, NOW);
    expect(verifySessionCookie(value, SECRET, NOW)).toEqual({
      ok: true,
      claims: { role: "student", id: ID, issuedAt: Math.floor(NOW.getTime() / 1000) },
    });
  });

  it("is deterministic for the same input and differs by role", () => {
    const a = signSessionCookie({ role: "staff", id: ID }, SECRET, NOW);
    expect(signSessionCookie({ role: "staff", id: ID }, SECRET, NOW)).toBe(a);
    expect(signSessionCookie({ role: "student", id: ID }, SECRET, NOW)).not.toBe(a);
  });

  it("rejects a payload edited to another role while keeping the old signature", () => {
    const value = signSessionCookie({ role: "student", id: ID }, SECRET, NOW);
    const [payload, signature] = value.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), r: "staff" }),
    ).toString("base64url");
    expect(verifySessionCookie(`${forged}.${signature}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects a flipped signature, a truncated signature and an empty signature", () => {
    const value = signSessionCookie({ role: "staff", id: ID }, SECRET, NOW);
    const [payload, signature] = value.split(".") as [string, string];
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    expect(verifySessionCookie(`${payload}.${flipped}`, SECRET, NOW)).toMatchObject({
      reason: "bad-signature",
    });
    expect(verifySessionCookie(`${payload}.${signature.slice(0, -4)}`, SECRET, NOW)).toMatchObject({
      reason: "bad-signature",
    });
    expect(verifySessionCookie(`${payload}.`, SECRET, NOW)).toMatchObject({ reason: "malformed" });
  });

  it("rejects a cookie signed with a different secret", () => {
    const value = signSessionCookie({ role: "staff", id: ID }, OTHER_SECRET, NOW);
    expect(verifySessionCookie(value, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it.each([
    ["undefined", undefined, "missing"],
    ["null", null, "missing"],
    ["empty", "", "missing"],
    ["no dot", "abcdef", "malformed"],
    ["two dots", "a.b.c", "malformed"],
    ["empty payload", ".abc", "malformed"],
  ] as const)("treats %s as unusable", (_label, value, reason) => {
    expect(verifySessionCookie(value, SECRET, NOW)).toEqual({ ok: false, reason });
  });

  it("rejects a correctly signed payload that is not JSON or has the wrong shape", () => {
    const verify = (payload: string) => verifySessionCookie(signedRaw(payload), SECRET, NOW);
    expect(verify("not json")).toMatchObject({ reason: "malformed" });
    expect(verify(JSON.stringify({ r: "admin", id: ID, iat: 1 }))).toMatchObject({
      reason: "malformed",
    });
    expect(verify(JSON.stringify({ r: "staff", id: "not-a-uuid", iat: 1 }))).toMatchObject({
      reason: "malformed",
    });
    expect(verify(JSON.stringify({ r: "staff", id: ID }))).toMatchObject({ reason: "malformed" });
  });

  it("expires after the maximum age, to the second", () => {
    const value = signSessionCookie({ role: "staff", id: ID }, SECRET, NOW);
    const justBefore = new Date(NOW.getTime() + (SESSION_MAX_AGE_SECONDS - 1) * 1000);
    const exactly = new Date(NOW.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
    expect(verifySessionCookie(value, SECRET, justBefore).ok).toBe(true);
    expect(verifySessionCookie(value, SECRET, exactly)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects an issued-at in the future beyond 60 seconds of clock skew", () => {
    const tooFar = signSessionCookie(
      { role: "staff", id: ID },
      SECRET,
      new Date(NOW.getTime() + 61_000),
    );
    expect(verifySessionCookie(tooFar, SECRET, NOW)).toEqual({
      ok: false,
      reason: "not-yet-valid",
    });
    const skewed = signSessionCookie(
      { role: "staff", id: ID },
      SECRET,
      new Date(NOW.getTime() + 60_000),
    );
    expect(verifySessionCookie(skewed, SECRET, NOW).ok).toBe(true);
  });

  it("refuses to sign or verify without a secret", () => {
    expect(() => signSessionCookie({ role: "staff", id: ID }, "", NOW)).toThrow(/SESSION_SECRET/);
    expect(() => verifySessionCookie("x.y", "", NOW)).toThrow(/SESSION_SECRET/);
  });
});

describe("readCookie", () => {
  it("finds a cookie among several", () => {
    expect(readCookie("a=1; sms_role=abc.def; b=2", "sms_role")).toBe("abc.def");
  });

  it("does not match a cookie whose name merely ends with the wanted name", () => {
    expect(readCookie("x_sms_role=evil; sms_role=good", "sms_role")).toBe("good");
    expect(readCookie("x_sms_role=evil", "sms_role")).toBeUndefined();
  });

  it("copes with a missing header or a part without an equals sign", () => {
    expect(readCookie(null, "sms_role")).toBeUndefined();
    expect(readCookie("", "sms_role")).toBeUndefined();
    expect(readCookie("flag; sms_role=ok", "sms_role")).toBe("ok");
  });
});

describe("Set-Cookie headers", () => {
  it("sets an HTTP-only, SameSite=Lax cookie for the whole site", () => {
    const header = buildSessionSetCookie("value");
    expect(header).toContain(`${SESSION_COOKIE_NAME}=value`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(header).not.toContain("Secure");
  });

  it("adds Secure when asked (production)", () => {
    expect(buildSessionSetCookie("value", { secure: true })).toContain("; Secure");
    expect(buildClearSessionCookie({ secure: true })).toContain("; Secure");
  });

  it("clears with an empty value and an immediate expiry, keeping the same attributes", () => {
    const header = buildClearSessionCookie();
    expect(header).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });
});
