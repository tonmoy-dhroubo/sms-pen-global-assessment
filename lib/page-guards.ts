import "server-only";
import { redirect } from "next/navigation";
import { currentIdentity } from "@/lib/session";
import type { StaffIdentity, StudentIdentity } from "@/lib/session";

// Role checks for Server Component pages and layouts (D-020). `proxy.ts` only verifies the cookie's signature, age and
// role; these also confirm the staff member or student still exists, and send anyone else to the role picker at `/`.
// A layout does not re-render when the user moves between pages inside it, so a page that loads data calls its own
// guard (Route Handlers keep using `requireStaff()` / `requireStudent()`, which throw 401/403 instead).

export async function requireStaffPage(): Promise<StaffIdentity> {
  const identity = await currentIdentity();
  if (identity?.role !== "staff") redirect("/");
  return identity;
}

export async function requireStudentPage(): Promise<StudentIdentity> {
  const identity = await currentIdentity();
  if (identity?.role !== "student") redirect("/");
  return identity;
}
