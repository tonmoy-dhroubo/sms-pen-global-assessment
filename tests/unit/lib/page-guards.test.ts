import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "@/lib/session";

// `server-only` throws outside Next's server bundle; here we are on the server, so make it a no-op.
vi.mock("server-only", () => ({}));

const redirect = vi.fn((path: string): never => {
  // Next's `redirect` throws to stop rendering; mimic that.
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));

let identity: Identity | null = null;
vi.mock("@/lib/session", () => ({ currentIdentity: async () => identity }));

const STAFF: Identity = {
  role: "staff",
  staff: { id: "s1", fullName: "Kamrul Hasan", email: "k@example.org", jobTitle: "Officer" },
};
const STUDENT: Identity = {
  role: "student",
  student: {
    id: "st1",
    studentNumber: "SMS-2026-0002",
    fullName: "Tanvir Hasan",
    email: "t@example.org",
    status: "ENROLLED",
  },
};

beforeEach(() => {
  redirect.mockClear();
  identity = null;
});

describe("requireStaffPage", () => {
  it("returns the staff identity", async () => {
    const { requireStaffPage } = await import("@/lib/page-guards");
    identity = STAFF;
    await expect(requireStaffPage()).resolves.toBe(STAFF);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a student to the role picker", async () => {
    const { requireStaffPage } = await import("@/lib/page-guards");
    identity = STUDENT;
    await expect(requireStaffPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("sends a missing or dangling session to the role picker", async () => {
    const { requireStaffPage } = await import("@/lib/page-guards");
    identity = null;
    await expect(requireStaffPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });
});

describe("requireStudentPage", () => {
  it("returns the student identity", async () => {
    const { requireStudentPage } = await import("@/lib/page-guards");
    identity = STUDENT;
    await expect(requireStudentPage()).resolves.toBe(STUDENT);
  });

  it("sends staff to the role picker", async () => {
    const { requireStudentPage } = await import("@/lib/page-guards");
    identity = STAFF;
    await expect(requireStudentPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("sends a missing or dangling session to the role picker", async () => {
    const { requireStudentPage } = await import("@/lib/page-guards");
    identity = null;
    await expect(requireStudentPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });
});
