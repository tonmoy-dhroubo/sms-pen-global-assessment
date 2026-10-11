import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  BusinessRuleError,
  ConflictError,
  DuplicateWarning,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
  VersionConflictError,
} from "@/lib/api/errors";
import { respond, route } from "@/lib/api/handler";
import { asStaff, asStudent, call } from "../../support/api";
import { createStaff, createStudent } from "../../support/factories";

// The wrapper itself, exercised through throwaway routes: the error shape for every error class, validation,
// warnings, request ids and the access levels.

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

describe("error shape", () => {
  const cases: [string, Error, number, string][] = [
    ["UnauthenticatedError", new UnauthenticatedError(), 401, "UNAUTHENTICATED"],
    ["ForbiddenError", new ForbiddenError(), 403, "FORBIDDEN"],
    ["NotFoundError", new NotFoundError(), 404, "NOT_FOUND"],
    ["ConflictError", new ConflictError("Email already used."), 409, "CONFLICT"],
    ["VersionConflictError", new VersionConflictError(4), 409, "VERSION_CONFLICT"],
    ["DuplicateWarning", new DuplicateWarning([{ id: "x" }]), 409, "DUPLICATE_WARNING"],
    [
      "BusinessRuleError",
      new BusinessRuleError("ASSESSMENT_CLOSED", "The assessment is closed."),
      422,
      "BUSINESS_RULE",
    ],
    [
      "ValidationError",
      ValidationError.field("email", "Enter a valid email."),
      400,
      "VALIDATION_ERROR",
    ],
  ];

  it.each(cases)("%s becomes %i %s", async (_name, error, status, code) => {
    const handler = route({ access: "public" }, () => {
      throw error;
    });
    const { body, status: actual } = await call<ErrorBody>(handler, { path: "/api/x" });
    expect(actual).toBe(status);
    expect(body.error.code).toBe(code);
    expect(body.error.message).toBe(error.message);
    expect(Object.keys(body)).toEqual(["error"]);
  });

  it("carries details for the classes that define them", async () => {
    const throwing = (error: Error) =>
      call<ErrorBody>(
        route({ access: "public" }, () => {
          throw error;
        }),
        { path: "/api/x" },
      );

    expect((await throwing(new VersionConflictError(7))).body.error.details).toEqual({
      currentVersion: 7,
    });
    expect(
      (await throwing(new DuplicateWarning([{ id: "abc", fullName: "Jose" }]))).body.error.details,
    ).toEqual({ matches: [{ id: "abc", fullName: "Jose" }] });
    expect(
      (await throwing(new BusinessRuleError("INVALID_TRANSITION", "No."))).body.error.details,
    ).toEqual({ rule: "INVALID_TRANSITION" });
    expect(
      (await throwing(new ConflictError("Duplicate reference.", { existingPaymentId: "p1" }))).body
        .error.details,
    ).toEqual({ existingPaymentId: "p1" });
    expect((await throwing(new ForbiddenError())).body.error).not.toHaveProperty("details");
  });
});

describe("unexpected errors", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("answers 500 with a generic message and no internals", async () => {
    const handler = route({ access: "public" }, () => {
      throw new Error("password=hunter2 leaked in a stack trace");
    });
    const { status, body, response } = await call<ErrorBody>(handler, { path: "/api/x" });

    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Something went wrong. Please try again.");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(body.error.details).toEqual({ requestId: response.headers.get("x-request-id") });
  });

  it("logs the error once with the request id, method and path", async () => {
    const handler = route({ access: "public" }, () => {
      throw new TypeError("boom");
    });
    const { response } = await call(handler, { method: "POST", path: "/api/things?x=1" });

    const spy = vi.mocked(console.error);
    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(spy.mock.calls[0]![0]));
    expect(entry).toMatchObject({
      level: "error",
      requestId: response.headers.get("x-request-id"),
      method: "POST",
      path: "/api/things",
      error: { name: "TypeError", message: "boom" },
    });
  });

  it("does not log expected API errors", async () => {
    const handler = route({ access: "public" }, () => {
      throw new NotFoundError();
    });
    await call(handler, { path: "/api/x" });
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("request ids", () => {
  it("generates one per request and returns it in x-request-id", async () => {
    const handler = route({ access: "public" }, () => ({ ok: true }));
    const a = await call(handler, { path: "/api/x" });
    const b = await call(handler, { path: "/api/x" });
    expect(a.response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.response.headers.get("x-request-id")).not.toBe(b.response.headers.get("x-request-id"));
  });

  it("reuses a sane incoming id and replaces a suspicious one", async () => {
    const handler = route({ access: "public" }, ({ requestId }) => ({ requestId }));
    const good = await call<{ requestId: string }>(handler, {
      path: "/api/x",
      headers: { "x-request-id": "trace-123" },
    });
    expect(good.body.requestId).toBe("trace-123");
    const bad = await call<{ requestId: string }>(handler, {
      path: "/api/x",
      headers: { "x-request-id": 'bad id with spaces"' },
    });
    expect(bad.body.requestId).not.toContain(" ");
  });

  it("marks every response as uncacheable", async () => {
    const { response } = await call(
      route({ access: "public" }, () => ({})),
      { path: "/api/x" },
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("validation", () => {
  const body = z.object({
    email: z.string().email("Enter a valid email address."),
    age: z.number().int().min(16, "Must be at least 16."),
    address: z.object({ city: z.string().min(1, "City is required.") }),
  });
  const handler = route({ access: "public", body }, ({ body: input }) => ({
    received: input.email,
  }));

  it("returns per-field messages, using dotted paths for nested fields", async () => {
    const { status, body: payload } = await call<ErrorBody>(handler, {
      method: "POST",
      path: "/api/x",
      body: { email: "nope", age: 3, address: { city: "" } },
    });
    expect(status).toBe(400);
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.message).toBe("Some fields are invalid.");
    expect(payload.error.details).toEqual({
      fieldErrors: {
        email: ["Enter a valid email address."],
        age: ["Must be at least 16."],
        "address.city": ["City is required."],
      },
    });
  });

  it("rejects a body that is not JSON as a form-level error", async () => {
    const { status, body: payload } = await call<ErrorBody>(handler, {
      method: "POST",
      path: "/api/x",
      body: "{not json",
    });
    expect(status).toBe(400);
    expect(payload.error.details).toEqual({
      fieldErrors: {},
      formErrors: ["The request body must be valid JSON."],
    });
  });

  it("treats a missing body as a validation error when the route requires one", async () => {
    const { status, body: payload } = await call<ErrorBody>(handler, {
      method: "POST",
      path: "/api/x",
    });
    expect(status).toBe(400);
    expect(payload.error.details).toHaveProperty("formErrors");
  });

  it("accepts a valid body", async () => {
    const { status, body: payload } = await call<{ received: string }>(handler, {
      method: "POST",
      path: "/api/x",
      body: { email: "a@b.test", age: 20, address: { city: "Dhaka" } },
    });
    expect(status).toBe(200);
    expect(payload.received).toBe("a@b.test");
  });

  it("validates and coerces the query string, collecting repeated keys into arrays", async () => {
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      status: z.array(z.string()).optional(),
    });
    const list = route({ access: "public", query }, ({ query: q }) => q);

    const ok = await call(list, { path: "/api/x?page=3&status=A&status=B" });
    expect(ok.body).toEqual({ page: 3, status: ["A", "B"] });
    expect((await call(list, { path: "/api/x" })).body).toEqual({ page: 1 });

    const bad = await call<ErrorBody>(list, { path: "/api/x?page=0" });
    expect(bad.status).toBe(400);
    expect(Object.keys((bad.body.error.details as { fieldErrors: object }).fieldErrors)).toEqual([
      "page",
    ]);
  });

  it("checks the role before validating the input", async () => {
    const staffOnly = route({ access: "staff", body }, () => ({}));
    const student = await createStudent();
    const forbidden = await call<ErrorBody>(staffOnly, {
      method: "POST",
      path: "/api/x",
      cookie: asStudent(student.id),
      body: {},
    });
    expect(forbidden.status).toBe(403);
    const anonymous = await call<ErrorBody>(staffOnly, {
      method: "POST",
      path: "/api/x",
      body: {},
    });
    expect(anonymous.status).toBe(401);
  });
});

describe("responses", () => {
  it("answers 200 with the returned value", async () => {
    const { status, body } = await call(
      route({ access: "public" }, () => ({ hello: "world" })),
      { path: "/api/x" },
    );
    expect(status).toBe(200);
    expect(body).toEqual({ hello: "world" });
  });

  it("lets a handler choose the status and headers with respond()", async () => {
    const handler = route({ access: "public" }, () =>
      respond({ id: "1" }, { status: 201, headers: { Location: "/api/things/1" } }),
    );
    const { status, response } = await call(handler, { method: "POST", path: "/api/x" });
    expect(status).toBe(201);
    expect(response.headers.get("location")).toBe("/api/things/1");
  });

  it("answers 204 with no body when nothing is returned", async () => {
    const { status, body } = await call(
      route({ access: "public" }, () => undefined),
      { method: "DELETE", path: "/api/x" },
    );
    expect(status).toBe(204);
    expect(body).toBeNull();
  });

  it("attaches warnings to object responses", async () => {
    const handler = route({ access: "public" }, ({ warn }) => {
      warn("OVERPAYMENT", "Payment is larger than the balance.");
      warn("OTHER", "Second.");
      return respond({ paymentId: "p1" }, { status: 201 });
    });
    const { status, body } = await call(handler, { method: "POST", path: "/api/x" });
    expect(status).toBe(201);
    expect(body).toEqual({
      paymentId: "p1",
      warnings: [
        { code: "OVERPAYMENT", message: "Payment is larger than the balance." },
        { code: "OTHER", message: "Second." },
      ],
    });
  });

  it("omits `warnings` when there are none, and ignores them on array bodies", async () => {
    const plain = await call(
      route({ access: "public" }, () => ({ a: 1 })),
      { path: "/api/x" },
    );
    expect(plain.body).toEqual({ a: 1 });

    const list = await call(
      route({ access: "public" }, ({ warn }) => {
        warn("W", "ignored");
        return [1, 2];
      }),
      { path: "/api/x" },
    );
    expect(list.body).toEqual([1, 2]);
  });

  it("does not attach warnings to error responses", async () => {
    const handler = route({ access: "public" }, ({ warn }) => {
      warn("W", "before the failure");
      throw new NotFoundError();
    });
    const { body } = await call<ErrorBody>(handler, { path: "/api/x" });
    expect(body).not.toHaveProperty("warnings");
  });

  it("resolves dynamic route params", async () => {
    const handler = route<"public", { id: string }>({ access: "public" }, ({ params }) => ({
      id: params.id,
    }));
    const { body } = await call(handler, { path: "/api/things/abc", params: { id: "abc" } });
    expect(body).toEqual({ id: "abc" });
  });
});

describe("access levels", () => {
  const ok = () => ({ ok: true });

  it("public never needs a session", async () => {
    const { status } = await call(route({ access: "public" }, ok), { path: "/api/x" });
    expect(status).toBe(200);
  });

  it("optional passes the identity when there is one and null otherwise", async () => {
    const staff = await createStaff();
    const handler = route({ access: "optional" }, ({ identity }) => ({
      role: identity?.role ?? null,
    }));
    expect((await call(handler, { path: "/api/x" })).body).toEqual({ role: null });
    expect((await call(handler, { path: "/api/x", cookie: asStaff(staff.id) })).body).toEqual({
      role: "staff",
    });
  });

  it("any needs a session of either role", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    const handler = route({ access: "any" }, ok);
    expect((await call(handler, { path: "/api/x" })).status).toBe(401);
    expect((await call(handler, { path: "/api/x", cookie: asStaff(staff.id) })).status).toBe(200);
    expect((await call(handler, { path: "/api/x", cookie: asStudent(student.id) })).status).toBe(
      200,
    );
  });

  it("staff: 401 without a session, 403 for a student, 200 for staff", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    const handler = route({ access: "staff" }, ok);
    expect((await call(handler, { path: "/api/x" })).status).toBe(401);
    expect((await call(handler, { path: "/api/x", cookie: asStudent(student.id) })).status).toBe(
      403,
    );
    expect((await call(handler, { path: "/api/x", cookie: asStaff(staff.id) })).status).toBe(200);
  });

  it("student: 401 without a session, 403 for staff, 200 for a student", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    const handler = route({ access: "student" }, ok);
    expect((await call(handler, { path: "/api/x" })).status).toBe(401);
    expect((await call(handler, { path: "/api/x", cookie: asStaff(staff.id) })).status).toBe(403);
    expect((await call(handler, { path: "/api/x", cookie: asStudent(student.id) })).status).toBe(
      200,
    );
  });
});
