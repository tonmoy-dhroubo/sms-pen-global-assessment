import fsp from "node:fs/promises";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getMe } from "@/app/api/me/route";
import { db } from "@/lib/db";
import { asStaff, asStudent, call } from "../../support/api";
import { createProgramme, createStaff, createStudent } from "../../support/factories";
import { isFilesystemRun } from "../../support/test-storage";

type ErrorBody = { error: { code: string; message: string } };

describe("GET /api/health", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports the database and storage as ok without any session", async () => {
    const { status, body } = await call(getHealth, { path: "/api/health" });
    expect(status).toBe(200);
    expect(body).toEqual({ db: "ok", storage: "ok" });
  });

  it("answers 503 when the database check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "$queryRaw").mockRejectedValueOnce(new Error("connection refused"));
    const { status, body } = await call(getHealth, { path: "/api/health" });
    expect(status).toBe(503);
    expect(body).toEqual({ db: "down", storage: "ok" });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the storage check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("connection refused");
    // The S3 check is a HeadBucket call; the filesystem check writes (and removes) a small probe file.
    if (isFilesystemRun()) vi.spyOn(fsp, "writeFile").mockRejectedValueOnce(failure);
    else vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(failure);
    const { status, body } = await call(getHealth, { path: "/api/health" });
    expect(status).toBe(503);
    expect(body).toEqual({ db: "ok", storage: "down" });
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/me", () => {
  it("returns the student's profile and what they may do", async () => {
    const programme = await createProgramme({ code: "BSC-CSE", name: "BSc Computer Science" });
    const student = await createStudent({
      fullName: "Ayesha Rahman",
      programmeId: programme.id,
    });
    const { status, body } = await call(getMe, { path: "/api/me", cookie: asStudent(student.id) });

    expect(status).toBe(200);
    expect(body).toEqual({
      student: {
        id: student.id,
        studentNumber: student.studentNumber,
        fullName: "Ayesha Rahman",
        email: student.email,
        dateOfBirth: "2005-03-14",
        programme: { id: programme.id, code: "BSC-CSE", name: "BSc Computer Science" },
        academicYear: "2026-27",
        yearOfStudy: 1,
        status: "ENROLLED",
      },
      canSubmit: { allowed: true, reason: null, message: null },
    });
  });

  it.each(["DEFERRED", "WITHDRAWN", "COMPLETED"] as const)(
    "says a %s student cannot submit, with the reason",
    async (status) => {
      const student = await createStudent({ status });
      const { body } = await call<{ student: { status: string }; canSubmit: unknown }>(getMe, {
        path: "/api/me",
        cookie: asStudent(student.id),
      });
      expect(body.student.status).toBe(status);
      expect(body.canSubmit).toEqual({
        allowed: false,
        reason: "NOT_ENROLLED",
        message: "Only enrolled students can submit work.",
      });
    },
  );

  it("is 401 without a session", async () => {
    const { status, body } = await call<ErrorBody>(getMe, { path: "/api/me" });
    expect(status).toBe(401);
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("is 403 for staff", async () => {
    const staff = await createStaff();
    const { status, body } = await call<ErrorBody>(getMe, {
      path: "/api/me",
      cookie: asStaff(staff.id),
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("is 401 for a student who no longer exists", async () => {
    const student = await createStudent();
    const cookie = asStudent(student.id);
    await db.student.delete({ where: { id: student.id } });
    const { status } = await call(getMe, { path: "/api/me", cookie });
    expect(status).toBe(401);
  });

  it("ignores any id in the query: it only ever returns the signed-in student", async () => {
    const me = await createStudent({ fullName: "Me Myself" });
    const other = await createStudent({ fullName: "Someone Else" });
    const { body } = await call<{ student: { id: string } }>(getMe, {
      path: `/api/me?studentId=${other.id}&id=${other.id}`,
      cookie: asStudent(me.id),
    });
    expect(body.student.id).toBe(me.id);
  });
});
