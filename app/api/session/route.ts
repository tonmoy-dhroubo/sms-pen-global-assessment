import { NotFoundError } from "@/lib/api/errors";
import { respond, route } from "@/lib/api/handler";
import { lookupIdentity, sessionClearCookie, sessionSetCookie } from "@/lib/session";
import type { Identity } from "@/lib/session";
import { switchSessionSchema } from "@/lib/validation/session";

// Who the browser is viewing as (D-008, D-020). The cookie is signed; there is no login.

/** The response body for an identity, as documented in api.md. */
function describe(identity: Identity | null) {
  if (!identity) return { role: null };
  return identity.role === "staff"
    ? { role: "staff" as const, staff: identity.staff }
    : { role: "student" as const, student: identity.student };
}

// GET: the current identity, or `{ role: null }` (never 401: "no session" is a normal answer here).
export const GET = route({ access: "optional" }, ({ identity }) => describe(identity));

// PUT: switch identity. Unknown ids are a 404; the cookie is only set once the record is known to exist.
export const PUT = route({ access: "public", body: switchSessionSchema }, async ({ body }) => {
  const identity = await lookupIdentity(
    body.role,
    body.role === "staff" ? body.staffId : body.studentId,
  );
  if (!identity) {
    throw new NotFoundError(
      body.role === "staff" ? "Staff member not found." : "Student not found.",
    );
  }

  const id = identity.role === "staff" ? identity.staff.id : identity.student.id;
  return respond(describe(identity), { cookies: [sessionSetCookie({ role: identity.role, id })] });
});

// DELETE: clear the cookie. Always succeeds, signed in or not.
export const DELETE = route({ access: "public" }, () =>
  respond(describe(null), { cookies: [sessionClearCookie()] }),
);
