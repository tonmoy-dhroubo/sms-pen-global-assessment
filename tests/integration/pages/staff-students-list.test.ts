import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asStaff } from "../../support/api";
import { createProgramme, createStaff, createStudent } from "../../support/factories";

// The student list page opened from the header quick search's "View all matches" link (edge-cases.md, M17): the link
// carries `q` plus all four `status` values, and the list must honour them together, so a Withdrawn or Completed match
// is not hidden by the default status filter. The page is a Server Component: called directly, rendered to HTML.

let currentCookie: string | undefined;
let currentSearch = "";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const [cookieName, value] = (currentCookie ?? "").split("=");
      return cookieName === name && value ? { name, value } : undefined;
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/staff/students",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const { default: StudentsPage } = await import("@/app/staff/students/page");

/** Renders the page for a query string, the way Next.js hands `searchParams` over (repeated keys become arrays). */
async function render(search: string) {
  currentSearch = search;
  const raw: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const existing = raw[key];
    raw[key] =
      existing === undefined
        ? value
        : [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  return renderToStaticMarkup(
    (await (StudentsPage as (props: unknown) => Promise<ReactNode>)({
      searchParams: Promise.resolve(raw),
    })) as ReactNode,
  );
}

beforeEach(() => {
  currentCookie = undefined;
});

describe("/staff/students from the quick search's View all link", () => {
  it("shows every status that matches the text, and only those", async () => {
    const staff = await createStaff();
    const programme = await createProgramme();
    await createStudent({ programmeId: programme.id, fullName: "Rahim Match Enrolled" });
    await createStudent({
      programmeId: programme.id,
      fullName: "Rahim Match Deferred",
      status: "DEFERRED",
    });
    await createStudent({
      programmeId: programme.id,
      fullName: "Rahim Match Withdrawn",
      status: "WITHDRAWN",
    });
    await createStudent({
      programmeId: programme.id,
      fullName: "Rahim Match Completed",
      status: "COMPLETED",
    });
    await createStudent({ programmeId: programme.id, fullName: "Someone Else" });
    currentCookie = asStaff(staff.id);

    const params = new URLSearchParams({ q: "match" });
    for (const status of ["ENROLLED", "DEFERRED", "WITHDRAWN", "COMPLETED"]) {
      params.append("status", status);
    }
    const html = await render(params.toString());
    expect(html).toContain("Rahim Match Enrolled");
    expect(html).toContain("Rahim Match Deferred");
    expect(html).toContain("Rahim Match Withdrawn");
    expect(html).toContain("Rahim Match Completed");
    expect(html).not.toContain("Someone Else");

    // Without the status values the default list hides Withdrawn and Completed, which is the gap this link closes.
    const byDefault = await render("q=match");
    expect(byDefault).toContain("Rahim Match Enrolled");
    expect(byDefault).not.toContain("Rahim Match Withdrawn");
    expect(byDefault).not.toContain("Rahim Match Completed");
  });

  it("guides the user when nothing matches", async () => {
    const staff = await createStaff();
    currentCookie = asStaff(staff.id);
    const html = await render("q=zzzznomatch");
    expect(html).toContain("No students match");
    expect(html).toContain("Clear search and filters");
  });
});
