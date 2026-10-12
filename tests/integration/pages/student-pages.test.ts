import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { asStaff, asStudent } from "../../support/api";
import { createStaff } from "../../support/factories";
import { expectNothingOfOthers, world } from "../../support/world";

// The student pages never render another student's data, however the URL is tampered with (edge-cases.md "Cross-cutting").
// The pages are Server Components, so they are called directly (with the signed role cookie served through a mocked
// `next/headers`) and the element they return is rendered to HTML. `redirect` and `notFound` are replaced by errors
// that name what Next.js would have done.

let currentCookie: string | undefined;

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
  usePathname: () => "/student",
}));

const { default: OverviewPage } = await import("@/app/student/page");
const { default: FeesPage } = await import("@/app/student/fees/page");
const { default: ResultsPage } = await import("@/app/student/results/page");
const { default: AssessmentsPage } = await import("@/app/student/assessments/page");
const { default: AssessmentPage } = await import("@/app/student/assessments/[id]/page");

type PageFn = (props: never) => Promise<ReactNode>;
const render = async (page: PageFn, props?: unknown) =>
  renderToStaticMarkup(await (page as (props: unknown) => Promise<ReactNode>)(props));

beforeEach(() => {
  currentCookie = undefined;
});

/** Query-string tampering a Server Component could be handed through `searchParams`. */
const tamper = (w: Awaited<ReturnType<typeof world>>) => ({
  searchParams: Promise.resolve({
    studentId: w.peer.id,
    id: w.peer.id,
    student: w.stranger.id,
  }),
});

describe("student pages show only the signed-in student's own data", () => {
  it("/student (overview)", async () => {
    const w = await world();
    currentCookie = w.cookie;
    const html = await render(OverviewPage, tamper(w));
    expect(html).toContain("Hello, Meher Rahman");
    expect(html).toContain(w.me.studentNumber);
    expect(html).toContain("Shared essay"); // my programme's open deadline
    expectNothingOfOthers(w, html);
    expect(html).not.toContain("Foreign project");
  });

  it("/student/fees", async () => {
    const w = await world();
    currentCookie = w.cookie;
    const html = await render(FeesPage, tamper(w));
    expect(html).toContain("No charges yet");
    expect(html).toContain("No payments yet");
    expectNothingOfOthers(w, html);
  });

  it("/student/results", async () => {
    const w = await world();
    currentCookie = w.cookie;
    const html = await render(ResultsPage, tamper(w));
    expect(html).toContain("Shared essay");
    expect(html).toContain("Not yet available");
    expectNothingOfOthers(w, html);
    expect(html).not.toContain("Foreign project");
  });

  it("/student/assessments", async () => {
    const w = await world();
    currentCookie = w.cookie;
    const html = await render(AssessmentsPage, tamper(w));
    expect(html).toContain("Shared essay");
    expectNothingOfOthers(w, html);
    expect(html).not.toContain("Foreign project");
  });

  it("/student/assessments/[id] for an assessment I share with a peer shows only my own submission", async () => {
    const w = await world();
    currentCookie = w.cookie;
    const html = await render(AssessmentPage, {
      params: Promise.resolve({ id: w.shared.id }),
      ...tamper(w),
    });
    expect(html).toContain("Shared essay");
    expect(html).toContain("Nothing submitted yet");
    expectNothingOfOthers(w, html);
  });

  it("/student/assessments/[id] is a 404 for an assessment of another programme, or for someone else's ids", async () => {
    const w = await world();
    currentCookie = w.cookie;
    for (const id of [w.foreign.id, w.peerFile.id, w.pending.id, w.peer.id, "not-a-uuid"]) {
      await expect(render(AssessmentPage, { params: Promise.resolve({ id }) })).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
    }
  });

  it("sanity check: the peer, who owns that file, does see it on the same page", async () => {
    const w = await world();
    currentCookie = asStudent(w.peer.id);
    const html = await render(AssessmentPage, {
      params: Promise.resolve({ id: w.shared.id }),
    });
    expect(html).toContain("peer-secret-essay.pdf"); // sanity: the data does exist and the owner does see it
  });

  it("a deleted student's cookie renders nothing: it goes back to the role picker", async () => {
    const w = await world();
    currentCookie = w.cookie;
    await db.mark.deleteMany({ where: { studentId: w.me.id } });
    await db.student.delete({ where: { id: w.me.id } });
    await expect(render(OverviewPage)).rejects.toThrow("NEXT_REDIRECT /");
  });
});

describe("student pages are for students", () => {
  const pages: [string, PageFn, unknown?][] = [
    ["/student", OverviewPage],
    ["/student/fees", FeesPage],
    ["/student/results", ResultsPage],
    ["/student/assessments", AssessmentsPage],
    [
      "/student/assessments/[id]",
      AssessmentPage,
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) },
    ],
  ];

  it.each(pages)("%s sends nobody without a session back to /", async (_route, page, props) => {
    currentCookie = undefined;
    await expect(render(page, props)).rejects.toThrow("NEXT_REDIRECT /");
  });

  it.each(pages)("%s sends a staff session back to /", async (_route, page, props) => {
    const staff = await createStaff();
    currentCookie = asStaff(staff.id);
    await expect(render(page, props)).rejects.toThrow("NEXT_REDIRECT /");
  });
});
