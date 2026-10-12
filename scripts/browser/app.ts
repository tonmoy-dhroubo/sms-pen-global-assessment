// Helpers shared by the browser scripts: sign in as a seeded role through the real API and look up the demo records the
// scripts open. They only read what `npm run db:reset` seeds, and talk to the app over HTTP like a browser would.

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

export type Role = "staff" | "student";

export interface Identity {
  role: Role;
  id: string;
  /** The signed `sms_role` cookie value. */
  cookie: string;
}

interface SessionOptions {
  staff: Array<{ id: string; fullName: string }>;
  students: { items: Array<{ id: string; fullName: string; studentNumber: string }> };
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.url} answered ${response.status}`);
  return (await response.json()) as T;
}

/** Signs in through `PUT /api/session` (as the role picker does) and returns the cookie it sets. */
export async function signIn(role: Role, id: string): Promise<Identity> {
  const body = role === "staff" ? { role, staffId: id } : { role, studentId: id };
  const response = await fetch(`${BASE_URL}/api/session`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Sign-in failed: ${response.status}`);
  const header = response.headers.getSetCookie().find((c) => c.startsWith("sms_role="));
  const cookie = header?.split(";")[0]?.slice("sms_role=".length);
  if (!cookie) throw new Error("The app did not set a role cookie.");
  return { role, id, cookie };
}

export async function signInFirstStaff(): Promise<Identity> {
  const options = await json<SessionOptions>(
    await fetch(`${BASE_URL}/api/session/options?limit=50`),
  );
  const staff = options.staff[0];
  if (!staff) throw new Error("No staff member found. Run `npm run db:reset` first.");
  return signIn("staff", staff.id);
}

/** Finds a seeded student by (part of) their name. */
export async function findStudent(name: string): Promise<{ id: string; fullName: string }> {
  const options = await json<SessionOptions>(
    await fetch(`${BASE_URL}/api/session/options?q=${encodeURIComponent(name)}&limit=10`),
  );
  const student = options.students.items[0];
  if (!student) throw new Error(`No student matching "${name}". Run \`npm run db:reset\` first.`);
  return student;
}

/** The assessment (by title fragment) from the staff list. */
export async function findAssessment(staff: Identity, title: string): Promise<{ id: string }> {
  const list = await json<{ items: Array<{ id: string; title: string }> }>(
    await fetch(`${BASE_URL}/api/assessments?limit=100`, {
      headers: { cookie: `sms_role=${staff.cookie}` },
    }),
  );
  const found = list.items.find((item) => item.title.toLowerCase().includes(title.toLowerCase()));
  if (!found) throw new Error(`No assessment titled like "${title}".`);
  return found;
}
