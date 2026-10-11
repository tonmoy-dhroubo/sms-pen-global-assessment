import type { Identity } from "@/lib/session";

// The few facts about "who is viewing" that client components need. Built on the server from the verified
// identity, so a student's email, date of birth and other details never reach the browser through the header.

export type CurrentIdentity =
  | { role: "staff"; id: string; fullName: string; jobTitle: string }
  | { role: "student"; id: string; fullName: string; studentNumber: string };

export function toCurrentIdentity(identity: Identity | null): CurrentIdentity | null {
  if (!identity) return null;
  if (identity.role === "staff") {
    const { id, fullName, jobTitle } = identity.staff;
    return { role: "staff", id, fullName, jobTitle };
  }
  const { id, fullName, studentNumber } = identity.student;
  return { role: "student", id, fullName, studentNumber };
}
