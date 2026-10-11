import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { ForbiddenError, UnauthenticatedError } from "@/lib/api/errors";
import { findStaff, findStudent } from "@/lib/services/identity";
import type { StaffProfile, StudentProfile } from "@/lib/services/identity";
import { systemClock } from "@/lib/services/clock";
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookie,
  buildSessionSetCookie,
  readCookie,
  signSessionCookie,
  verifySessionCookie,
} from "@/lib/session-cookie";
import type { SessionRole } from "@/lib/session-cookie";

// Server-side role handling (D-008, D-020). The cookie proves who the browser claims to be; this file also checks
// that the record still exists. A cookie for a deleted student is the same as no cookie. The proxy only does the
// cheap signature check; everything that serves data goes through here.

export type StaffIdentity = { role: "staff"; staff: StaffProfile };
export type StudentIdentity = { role: "student"; student: StudentProfile };
export type Identity = StaffIdentity | StudentIdentity;

const secure = () => process.env.NODE_ENV === "production";

/** The `Set-Cookie` value that switches the browser to this identity. */
export function sessionSetCookie(
  identity: { role: SessionRole; id: string },
  now: Date = systemClock(),
): string {
  return buildSessionSetCookie(signSessionCookie(identity, env.SESSION_SECRET, now), {
    secure: secure(),
  });
}

/** The `Set-Cookie` value that clears the role cookie. */
export function sessionClearCookie(): string {
  return buildClearSessionCookie({ secure: secure() });
}

/** Loads the staff member or student a role points at; `null` when that record does not exist. */
export async function lookupIdentity(role: SessionRole, id: string): Promise<Identity | null> {
  if (role === "staff") {
    const staff = await findStaff(id);
    return staff ? { role, staff } : null;
  }
  const student = await findStudent(id);
  return student ? { role, student } : null;
}

/**
 * Turns a raw cookie value into an identity, or `null` when there is no usable session: missing, tampered,
 * expired, or pointing at a staff member or student that no longer exists.
 */
export async function resolveIdentity(
  cookieValue: string | null | undefined,
  now: Date = systemClock(),
): Promise<Identity | null> {
  const verified = verifySessionCookie(cookieValue, env.SESSION_SECRET, now);
  if (!verified.ok) return null;

  return lookupIdentity(verified.claims.role, verified.claims.id);
}

/** The identity behind a Route Handler's request. */
export function identityFromRequest(request: Request): Promise<Identity | null> {
  return resolveIdentity(readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME));
}

/** The identity of the current request in a Server Component, layout or Server Action. */
export async function currentIdentity(): Promise<Identity | null> {
  const store = await cookies();
  return resolveIdentity(store.get(SESSION_COOKIE_NAME)?.value);
}

/** `401` when there is no session, `403` when the session is for the other role. */
export function assertStaff(identity: Identity | null): StaffIdentity {
  if (!identity) throw new UnauthenticatedError();
  if (identity.role !== "staff") throw new ForbiddenError("This is only available to staff.");
  return identity;
}

export function assertStudent(identity: Identity | null): StudentIdentity {
  if (!identity) throw new UnauthenticatedError();
  if (identity.role !== "student") throw new ForbiddenError("This is only available to students.");
  return identity;
}

export function assertSignedIn(identity: Identity | null): Identity {
  if (!identity) throw new UnauthenticatedError();
  return identity;
}

/** For server code that must run as staff. Throws `UnauthenticatedError` / `ForbiddenError`. */
export async function requireStaff(): Promise<StaffIdentity> {
  return assertStaff(await currentIdentity());
}

/** For server code that must run as a student. Throws `UnauthenticatedError` / `ForbiddenError`. */
export async function requireStudent(): Promise<StudentIdentity> {
  return assertStudent(await currentIdentity());
}
