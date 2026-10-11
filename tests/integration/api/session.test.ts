import { describe, expect, it } from "vitest";
import { DELETE, GET, PUT } from "@/app/api/session/route";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signSessionCookie,
} from "@/lib/session-cookie";
import { TEST_SESSION_SECRET } from "../../support/constants";
import { asStaff, asStudent, call, cookieFromSetCookie } from "../../support/api";
import { createStaff, createStudent } from "../../support/factories";

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

const UNKNOWN_ID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/session", () => {
  it("reports no session without a cookie", async () => {
    const { status, body } = await call(GET, { path: "/api/session" });
    expect(status).toBe(200);
    expect(body).toEqual({ role: null });
  });

  it("returns the staff member behind a staff cookie", async () => {
    const staff = await createStaff({ fullName: "Rafiq Hasan", jobTitle: "Registry Officer" });
    const { status, body } = await call(GET, { path: "/api/session", cookie: asStaff(staff.id) });
    expect(status).toBe(200);
    expect(body).toEqual({
      role: "staff",
      staff: {
        id: staff.id,
        fullName: "Rafiq Hasan",
        email: staff.email,
        jobTitle: "Registry Officer",
      },
    });
  });

  it("returns the student behind a student cookie", async () => {
    const student = await createStudent({ fullName: "Ayesha Rahman", status: "DEFERRED" });
    const { body } = await call(GET, { path: "/api/session", cookie: asStudent(student.id) });
    expect(body).toEqual({
      role: "student",
      student: {
        id: student.id,
        studentNumber: student.studentNumber,
        fullName: "Ayesha Rahman",
        email: student.email,
        status: "DEFERRED",
      },
    });
  });

  it("treats a tampered cookie as no session", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    // Take a student's cookie and swap the payload for a staff identity, keeping the old signature.
    const signature = signSessionCookie(
      { role: "student", id: student.id },
      TEST_SESSION_SECRET,
    ).split(".")[1];
    const forgedPayload = signSessionCookie(
      { role: "staff", id: staff.id },
      TEST_SESSION_SECRET,
    ).split(".")[0];
    const { body } = await call(GET, {
      path: "/api/session",
      cookie: `${SESSION_COOKIE_NAME}=${forgedPayload}.${signature}`,
    });
    expect(body).toEqual({ role: null });
  });

  it("treats a cookie signed with another secret as no session", async () => {
    const staff = await createStaff();
    const cookie = signSessionCookie(
      { role: "staff", id: staff.id },
      "some-other-secret-that-is-at-least-32-chars",
    );
    const { body } = await call(GET, {
      path: "/api/session",
      cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
    });
    expect(body).toEqual({ role: null });
  });

  it("treats garbage as no session", async () => {
    const { body } = await call(GET, {
      path: "/api/session",
      cookie: `${SESSION_COOKIE_NAME}=not-a-real-cookie`,
    });
    expect(body).toEqual({ role: null });
  });

  it("treats an expired cookie as no session", async () => {
    const staff = await createStaff();
    const issued = new Date(Date.now() - (SESSION_MAX_AGE_SECONDS + 5) * 1000);
    const { body } = await call(GET, {
      path: "/api/session",
      cookie: asStaff(staff.id, issued),
    });
    expect(body).toEqual({ role: null });
  });

  it("still accepts a cookie issued just inside the lifetime", async () => {
    const staff = await createStaff();
    const issued = new Date(Date.now() - (SESSION_MAX_AGE_SECONDS - 60) * 1000);
    const { body } = await call<{ role: string }>(GET, {
      path: "/api/session",
      cookie: asStaff(staff.id, issued),
    });
    expect(body.role).toBe("staff");
  });

  it("treats a cookie for a deleted student as no session", async () => {
    const student = await createStudent();
    const cookie = asStudent(student.id);
    expect((await call<{ role: string }>(GET, { path: "/api/session", cookie })).body.role).toBe(
      "student",
    );

    await db.student.delete({ where: { id: student.id } });
    expect((await call(GET, { path: "/api/session", cookie })).body).toEqual({ role: null });
  });

  it("treats a cookie for a deleted staff member as no session", async () => {
    const staff = await createStaff();
    const cookie = asStaff(staff.id);
    await db.staff.delete({ where: { id: staff.id } });
    expect((await call(GET, { path: "/api/session", cookie })).body).toEqual({ role: null });
  });
});

describe("PUT /api/session", () => {
  it("switches to staff: returns the identity and sets a signed, HTTP-only cookie", async () => {
    const staff = await createStaff({ fullName: "Rafiq Hasan" });
    const { status, body, setCookies } = await call<{ role: string; staff: { id: string } }>(PUT, {
      method: "PUT",
      path: "/api/session",
      body: { role: "staff", staffId: staff.id },
    });

    expect(status).toBe(200);
    expect(body.role).toBe("staff");
    expect(body.staff.id).toBe(staff.id);

    expect(setCookies).toHaveLength(1);
    const header = setCookies[0]!;
    expect(header.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(header).not.toContain("Secure"); // tests do not run with NODE_ENV=production
  });

  it("the cookie it sets is accepted by GET /api/session", async () => {
    const student = await createStudent({ fullName: "Ayesha Rahman" });
    const put = await call(PUT, {
      method: "PUT",
      path: "/api/session",
      body: { role: "student", studentId: student.id },
    });
    const { body } = await call<{ role: string; student: { id: string } }>(GET, {
      path: "/api/session",
      cookie: cookieFromSetCookie(put.setCookies[0]!),
    });
    expect(body.role).toBe("student");
    expect(body.student.id).toBe(student.id);
  });

  it("sets the Secure flag in production", async () => {
    const staff = await createStaff();
    const original = process.env.NODE_ENV;
    // `NODE_ENV` is typed read-only by Next's types; the cast is the only way to flip it for this one test.
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const { setCookies } = await call(PUT, {
        method: "PUT",
        path: "/api/session",
        body: { role: "staff", staffId: staff.id },
      });
      expect(setCookies[0]).toContain("; Secure");
    } finally {
      (process.env as Record<string, string>).NODE_ENV = original!;
    }
  });

  it("a student switching to staff replaces the old identity", async () => {
    const student = await createStudent();
    const staff = await createStaff();
    const put = await call(PUT, {
      method: "PUT",
      path: "/api/session",
      cookie: asStudent(student.id),
      body: { role: "staff", staffId: staff.id },
    });
    const { body } = await call<{ role: string }>(GET, {
      path: "/api/session",
      cookie: cookieFromSetCookie(put.setCookies[0]!),
    });
    expect(body.role).toBe("staff");
  });

  it("answers 404 for an unknown staff member and sets no cookie", async () => {
    const { status, body, setCookies } = await call<ErrorBody>(PUT, {
      method: "PUT",
      path: "/api/session",
      body: { role: "staff", staffId: UNKNOWN_ID },
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(setCookies).toEqual([]);
  });

  it("answers 404 for an unknown student and sets no cookie", async () => {
    const { status, body, setCookies } = await call<ErrorBody>(PUT, {
      method: "PUT",
      path: "/api/session",
      body: { role: "student", studentId: UNKNOWN_ID },
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(setCookies).toEqual([]);
  });

  it("does not let a staff id be used as a student id (or the reverse)", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    expect(
      (
        await call(PUT, {
          method: "PUT",
          path: "/api/session",
          body: { role: "student", studentId: staff.id },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(PUT, {
          method: "PUT",
          path: "/api/session",
          body: { role: "staff", staffId: student.id },
        })
      ).status,
    ).toBe(404);
  });

  it.each([
    ["an unknown role", { role: "admin", staffId: UNKNOWN_ID }, "role"],
    ["a missing role", { staffId: UNKNOWN_ID }, "role"],
    ["staff without staffId", { role: "staff" }, "staffId"],
    ["student without studentId", { role: "student" }, "studentId"],
    ["a malformed staff id", { role: "staff", staffId: "abc" }, "staffId"],
    ["a malformed student id", { role: "student", studentId: "12345" }, "studentId"],
  ])("answers 400 for %s", async (_label, body, field) => {
    const result = await call<ErrorBody>(PUT, { method: "PUT", path: "/api/session", body });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(result.setCookies).toEqual([]);
    const details = result.body.error.details as {
      fieldErrors: Record<string, string[]>;
      formErrors?: string[];
    };
    // Field-level problems point at the field; a missing/unknown role is reported against `role`.
    expect(Object.keys(details.fieldErrors).concat(details.formErrors ? ["(form)"] : [])).toContain(
      field,
    );
  });

  it("answers 400 for a missing or non-JSON body", async () => {
    expect((await call(PUT, { method: "PUT", path: "/api/session" })).status).toBe(400);
    expect((await call(PUT, { method: "PUT", path: "/api/session", body: "nope" })).status).toBe(
      400,
    );
  });
});

describe("DELETE /api/session", () => {
  it("clears the cookie and reports no role", async () => {
    const staff = await createStaff();
    const { status, body, setCookies } = await call(DELETE, {
      method: "DELETE",
      path: "/api/session",
      cookie: asStaff(staff.id),
    });
    expect(status).toBe(200);
    expect(body).toEqual({ role: null });
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(setCookies[0]).toContain("Max-Age=0");
    expect(setCookies[0]).toContain("HttpOnly");
  });

  it("succeeds even when there was no session", async () => {
    const { status, body } = await call(DELETE, { method: "DELETE", path: "/api/session" });
    expect(status).toBe(200);
    expect(body).toEqual({ role: null });
  });
});
