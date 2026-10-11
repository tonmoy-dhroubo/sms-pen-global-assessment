import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/session-cookie";
import type { SessionRole } from "@/lib/session-cookie";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (same behaviour, Node.js runtime).
//
// Only the cheap check lives here: the role cookie's signature and age, and that its role matches the area being
// opened (`/staff/*` needs staff, `/student/*` needs a student). Anything else goes back to the role picker at `/`.
// It never touches the database, so it cannot tell that a student was deleted; pages and Route Handlers re-verify
// through `lib/session.ts`, which does (D-020).

const AREA_ROLE: Record<string, SessionRole> = {
  staff: "staff",
  student: "student",
};

export function proxy(request: NextRequest) {
  const area = request.nextUrl.pathname.split("/")[1] ?? "";
  const required = AREA_ROLE[area];
  if (!required) return NextResponse.next();

  const secret = process.env.SESSION_SECRET ?? "";
  const verified = secret
    ? verifySessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value, secret)
    : null;

  if (verified?.ok && verified.claims.role === required) return NextResponse.next();
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/staff", "/staff/:path*", "/student", "/student/:path*"],
};
