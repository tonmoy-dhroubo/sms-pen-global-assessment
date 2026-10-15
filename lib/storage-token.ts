import { createHmac, timingSafeEqual } from "node:crypto";

// Signed tokens for the filesystem storage driver (D-045). With S3 the storage server checks a presigned URL's
// signature; with files on disk the app does, so a "presigned" URL is `/api/uploads/<token>`. The token carries what
// the URL is allowed to do and is signed with HMAC-SHA256 under a key derived from SESSION_SECRET. No `server-only`
// and no environment access, so it can be unit-tested (the secret is passed in).

/** An upload: one PUT of exactly `len` bytes of `ct` to the one pending key `key`. */
export interface UploadClaims {
  typ: "put";
  key: string;
  ct: string;
  len: number;
  /** Expiry, ms since the epoch. */
  exp: number;
}

/** A download: one GET of the object at `key`, saved as `name`. */
export interface DownloadClaims {
  typ: "get";
  key: string;
  name: string;
  exp: number;
}

export type TokenClaims = UploadClaims | DownloadClaims;

export type TokenCheck =
  { ok: true; claims: TokenClaims } | { ok: false; reason: "malformed" | "signature" | "expired" };

const VERSION = "v1";

function signingKey(secret: string): Buffer {
  // Domain separation: the session cookie is signed with the same secret and must never be usable as a storage token.
  return createHmac("sha256", secret).update("sms-storage-token-v1").digest();
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret)).update(payload).digest();
}

export function signToken(claims: TokenClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${VERSION}.${payload}.${sign(`${VERSION}.${payload}`, secret).toString("base64url")}`;
}

function isClaims(value: unknown): value is TokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.key !== "string" || typeof c.exp !== "number" || !Number.isFinite(c.exp))
    return false;
  if (c.typ === "put") {
    return typeof c.ct === "string" && Number.isInteger(c.len) && (c.len as number) >= 0;
  }
  return c.typ === "get" && typeof c.name === "string";
}

/** Checks the signature first, then the expiry. A token that fails either gives no claims at all. */
export function verifyToken(token: string, secret: string, now: Date = new Date()): TokenCheck {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };
  const [, payload, signature] = parts as [string, string, string];

  const expected = sign(`${VERSION}.${payload}`, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "signature" };
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isClaims(claims)) return { ok: false, reason: "malformed" };
  if (claims.exp <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
