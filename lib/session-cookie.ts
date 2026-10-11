import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// The signed role cookie (D-008, D-020). Pure: no `process.env`, no database, no `server-only`, so it is
// unit-testable and the Next.js proxy can import it. `lib/session.ts` adds the server-side wiring.
//
// Value format: `<payload>.<signature>`, both base64url. The payload is JSON `{ r, id, iat }` (role, record id,
// issued-at in Unix seconds); the signature is HMAC-SHA256 over the payload string with SESSION_SECRET.

export const SESSION_COOKIE_NAME = "sms_role";

/**
 * How long a role cookie stays valid. The brief makes auth optional, so this is only a stand-in for a session
 * lifetime: long enough that reviewers are not signed out mid-demo.
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Clock skew tolerated when a cookie's issued-at is slightly in the future. */
const FUTURE_SKEW_SECONDS = 60;

export type SessionRole = "staff" | "student";

export interface SessionClaims {
  role: SessionRole;
  /** The `Staff.id` or `Student.id` the cookie points at. */
  id: string;
  /** Issued at, Unix seconds. */
  issuedAt: number;
}

export type VerifyFailure = "missing" | "malformed" | "bad-signature" | "expired" | "not-yet-valid";

export type VerifyResult =
  { ok: true; claims: SessionClaims } | { ok: false; reason: VerifyFailure };

const payloadSchema = z.object({
  r: z.enum(["staff", "student"]),
  id: z.string().uuid(),
  iat: z.number().int().nonnegative(),
});

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function assertSecret(secret: string) {
  if (!secret) throw new Error("SESSION_SECRET is required to sign or verify the role cookie.");
}

/** Builds the cookie value for an identity. */
export function signSessionCookie(
  identity: { role: SessionRole; id: string },
  secret: string,
  now: Date = new Date(),
): string {
  assertSecret(secret);
  const payload = toBase64Url(
    JSON.stringify({
      r: identity.role,
      id: identity.id,
      iat: Math.floor(now.getTime() / 1000),
    }),
  );
  return `${payload}.${toBase64Url(sign(payload, secret))}`;
}

/**
 * Checks a cookie value: the signature (constant-time), the payload shape and the age. Never throws on bad
 * input; the reason is for tests and logs, callers treat every failure as "no session".
 */
export function verifySessionCookie(
  value: string | null | undefined,
  secret: string,
  now: Date = new Date(),
): VerifyResult {
  assertSecret(secret);
  if (!value) return { ok: false, reason: "missing" };

  const parts = value.split(".");
  const [payload, signature] = parts;
  if (parts.length !== 2 || !payload || !signature) return { ok: false, reason: "malformed" };

  const given = Buffer.from(signature, "base64url");
  const expected = sign(payload, secret);
  // `timingSafeEqual` throws on unequal lengths, so compare lengths first (the length is not secret).
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "malformed" };

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const { r: role, id, iat: issuedAt } = parsed.data;
  if (issuedAt > nowSeconds + FUTURE_SKEW_SECONDS) return { ok: false, reason: "not-yet-valid" };
  if (nowSeconds - issuedAt >= SESSION_MAX_AGE_SECONDS) return { ok: false, reason: "expired" };

  return { ok: true, claims: { role, id, issuedAt } };
}

/** Reads one cookie out of a `Cookie` request header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

interface CookieOptions {
  /** `Secure` is added in production (cookies over plain HTTP only work on localhost in development). */
  secure?: boolean;
}

/** `Set-Cookie` header value that stores the role cookie: HTTP-only, `SameSite=Lax`, whole site. */
export function buildSessionSetCookie(value: string, options: CookieOptions = {}): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** `Set-Cookie` header value that removes the role cookie (same attributes, so browsers match it). */
export function buildClearSessionCookie(options: CookieOptions = {}): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
