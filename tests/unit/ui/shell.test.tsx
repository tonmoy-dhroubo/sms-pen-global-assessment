// @vitest-environment jsdom
import "@/tests/support/dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoBanner } from "@/components/layout/demo-banner";
import { isActivePath, STAFF_NAV, STUDENT_NAV } from "@/components/layout/nav-config";
import { StaffMobileNav, StaffSidebar } from "@/components/layout/staff-nav";
import { StudentTabs } from "@/components/layout/student-tabs";
import { toCurrentIdentity } from "@/components/session/current-identity";
import type { Identity } from "@/lib/session";

let pathname = "/staff";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

beforeEach(() => {
  pathname = "/staff";
});

describe("DemoBanner", () => {
  it("is shown when DEMO_MODE is on", () => {
    render(<DemoBanner show />);
    expect(screen.getByRole("region", { name: "Demo environment" })).toBeTruthy();
    expect(screen.getByText(/Demo environment/)).toBeTruthy();
  });

  it("renders nothing when it is off", () => {
    const { container } = render(<DemoBanner show={false} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("navigation config", () => {
  it("lists the staff sidebar and student tabs from pages.md, in order", () => {
    expect(STAFF_NAV.map((item) => item.label)).toEqual([
      "Dashboard",
      "Students",
      "Fees",
      "Assessments",
      "Programmes",
    ]);
    expect(STUDENT_NAV.map((item) => item.label)).toEqual([
      "Overview",
      "Fees",
      "Assessments",
      "Results",
    ]);
  });

  it("matches section homes exactly and other sections by prefix", () => {
    const dashboard = STAFF_NAV[0]!;
    const students = STAFF_NAV[1]!;
    expect(isActivePath("/staff", dashboard)).toBe(true);
    expect(isActivePath("/staff/students", dashboard)).toBe(false);
    expect(isActivePath("/staff/students", students)).toBe(true);
    expect(isActivePath("/staff/students/abc/edit", students)).toBe(true);
    expect(isActivePath("/staff/studentsX", students)).toBe(false);
  });
});

describe("StaffSidebar", () => {
  it("is a labelled navigation landmark marking the current page", () => {
    pathname = "/staff/students/123";
    render(<StaffSidebar />);
    const nav = screen.getByRole("navigation", { name: "Staff" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(STAFF_NAV.map((item) => item.label));
    expect(links.filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(within(nav).getByRole("link", { name: "Students" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });
});

describe("StaffMobileNav", () => {
  it("opens the same links in a sheet and closes after choosing one", async () => {
    const user = userEvent.setup();
    render(<StaffMobileNav />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(STAFF_NAV.map((item) => item.label));

    await user.click(within(dialog).getByRole("link", { name: "Fees" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("StudentTabs", () => {
  it.each([
    ["/student", "Overview"],
    ["/student/fees", "Fees"],
    ["/student/assessments/abc", "Assessments"],
    ["/student/results", "Results"],
  ])("marks the tab for %s as current", (path, label) => {
    pathname = path;
    render(<StudentTabs />);
    const nav = screen.getByRole("navigation", { name: "Student sections" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });
});

describe("toCurrentIdentity", () => {
  it("is null without a session", () => {
    expect(toCurrentIdentity(null)).toBeNull();
  });

  it("keeps only what the header needs for staff", () => {
    const identity: Identity = {
      role: "staff",
      staff: {
        id: "s1",
        fullName: "Kamrul Hasan",
        email: "k@example.org",
        jobTitle: "Registry Officer",
      },
    };
    expect(toCurrentIdentity(identity)).toEqual({
      role: "staff",
      id: "s1",
      fullName: "Kamrul Hasan",
      jobTitle: "Registry Officer",
    });
  });

  it("does not pass a student's email or status to the browser", () => {
    const identity: Identity = {
      role: "student",
      student: {
        id: "st1",
        studentNumber: "SMS-2026-0002",
        fullName: "Tanvir Hasan",
        email: "tanvir@example.org",
        status: "ENROLLED",
      },
    };
    const result = toCurrentIdentity(identity);
    expect(result).toEqual({
      role: "student",
      id: "st1",
      fullName: "Tanvir Hasan",
      studentNumber: "SMS-2026-0002",
    });
    expect(JSON.stringify(result)).not.toContain("example.org");
  });
});
