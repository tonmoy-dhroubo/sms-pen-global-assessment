/// <reference types="vite/client" />
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Access } from "@/lib/api/handler";
import { asStaff, asStudent, call } from "../../support/api";
import { createStaff, createStudent } from "../../support/factories";

// Every Route Handler under app/api, discovered from the file system, must enforce the role it declares (api.md "Roles
// and access"). The core rule of this suite: a student session gets 403 from every staff-only route, so a route added
// later cannot slip through unguarded.
//
// Two layers keep that honest:
//   1. EXPECTED_ACCESS below is the reviewed list of who may call what. A new route that is not in it fails the
//      "knows every route" test until someone decides, in a diff, who may call it. This is what stops a staff route
//      from being added as `access: "any"` by mistake.
//   2. Each handler carries the access it was built with (`route()` attaches it), and the matrix below then calls it as
//      nobody, as staff and as a student and checks the status.

const EXPECTED_ACCESS: Record<string, Access> = {
  "GET /api/assessments": "staff",
  "POST /api/assessments": "staff",
  "GET /api/assessments/[id]": "staff",
  "PATCH /api/assessments/[id]": "staff",
  "POST /api/assessments/[id]/close": "staff",
  "POST /api/assessments/[id]/reopen": "staff",
  "GET /api/assessments/[id]/marks": "staff",
  "PUT /api/assessments/[id]/marks/[studentId]": "staff",
  "GET /api/assessments/[id]/submissions": "staff",
  "POST /api/assessments/[id]/submission/upload-url": "student",
  "POST /api/assessments/[id]/submission/confirm": "student",
  "GET /api/dashboard": "staff",
  "GET /api/fees": "staff",
  "GET /api/exports/marksheet/[file]": "staff",
  "GET /api/exports/overdue.csv": "staff",
  "GET /api/files/[fileId]/download": "any",
  "GET /api/health": "public",
  "POST /api/marks/publish": "staff",
  "POST /api/marks/unpublish": "staff",
  "POST /api/marks/withhold": "staff",
  "GET /api/me": "student",
  "GET /api/me/fees": "student",
  "GET /api/me/assessments": "student",
  "GET /api/me/assessments/[id]/submission": "student",
  "GET /api/me/results": "student",
  "GET /api/modules": "any",
  "POST /api/payments/[id]/void": "staff",
  "GET /api/programmes": "any",
  "GET /api/programmes/[id]": "staff",
  "PUT /api/programmes/[id]/fees/[academicYear]": "staff",
  "GET /api/session": "optional",
  "PUT /api/session": "public",
  "DELETE /api/session": "public",
  "GET /api/session/options": "public",
  "GET /api/students": "staff",
  "POST /api/students": "staff",
  "GET /api/students/[id]": "staff",
  "PATCH /api/students/[id]": "staff",
  "POST /api/students/[id]/charges": "staff",
  "GET /api/students/[id]/fees": "staff",
  "POST /api/students/[id]/payments": "staff",
  "GET /api/students/[id]/results": "staff",
  "POST /api/students/[id]/status": "staff",
  "GET /api/students/[id]/timeline": "staff",
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

type Handler = ((request: Request, context?: { params: Promise<never> }) => Promise<Response>) & {
  access?: Access;
};

interface Discovered {
  key: string;
  method: string;
  pattern: string;
  handler: Handler;
}

const API_ROOT = path.resolve(import.meta.dirname, "../../../app/api");

/** `app/api/.../route.ts` files found on disk, as route patterns such as `/api/students/[id]/fees`. */
function routePatternsOnDisk(): string[] {
  return readdirSync(API_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "route.ts")
    .map((entry) => {
      const relative = path.relative(API_ROOT, entry.parentPath).split(path.sep).join("/");
      return relative === "" ? "/api" : `/api/${relative}`;
    })
    .sort();
}

const modules = import.meta.glob<Record<string, unknown>>("../../../app/api/**/route.ts");

async function discover(): Promise<Discovered[]> {
  const found: Discovered[] = [];
  for (const [file, load] of Object.entries(modules)) {
    const pattern = `/api/${file.split("/app/api/")[1]!.replace(/\/?route\.ts$/, "")}`.replace(
      /\/$/,
      "",
    );
    const exports = await load();
    for (const method of HTTP_METHODS) {
      const handler = exports[method];
      if (typeof handler === "function") {
        found.push({ key: `${method} ${pattern}`, method, pattern, handler: handler as Handler });
      }
    }
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

/** The URL for a route pattern, with a fresh UUID standing in for every `[segment]`. */
function concretise(pattern: string): { url: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const url = pattern.replace(/\[(\w+)\]/g, (_, name: string) => {
    params[name] = name === "academicYear" ? "2026-27" : randomUUID();
    return params[name];
  });
  return { url, params };
}

const routes = await discover();

describe("route discovery", () => {
  it("finds the route files on disk", () => {
    const onDisk = routePatternsOnDisk();
    expect(onDisk.length).toBeGreaterThan(20);
    const discovered = [...new Set(routes.map((route) => route.pattern))].sort();
    expect(discovered).toEqual(onDisk);
  });

  it("exports only HTTP method handlers built with route()", () => {
    for (const route of routes) {
      expect(route.handler.access, `${route.key} must be built with route()`).toBeDefined();
    }
  });

  it("knows every route: a new one must be added to EXPECTED_ACCESS, deciding who may call it", () => {
    expect(routes.map((route) => route.key)).toEqual(Object.keys(EXPECTED_ACCESS).sort());
  });

  it.each(routes)("$key declares the access it is expected to have", ({ key, handler }) => {
    expect(handler.access).toBe(EXPECTED_ACCESS[key]);
  });
});

describe("every route enforces its role", () => {
  async function sessions() {
    const staff = await createStaff();
    const student = await createStudent();
    return { staff: asStaff(staff.id), student: asStudent(student.id) };
  }

  function callAs(route: Discovered, cookie: string | undefined) {
    const { url, params } = concretise(route.pattern);
    return call(route.handler, { method: route.method, path: url, params, cookie });
  }

  const staffOnly = routes.filter((route) => route.handler.access === "staff");
  const studentOnly = routes.filter((route) => route.handler.access === "student");
  const either = routes.filter((route) => route.handler.access === "any");
  const open = routes.filter((route) => ["public", "optional"].includes(route.handler.access!));

  it("has staff-only routes, student-only routes and shared ones to check", () => {
    expect(staffOnly.length).toBeGreaterThan(15);
    expect(studentOnly.length).toBeGreaterThanOrEqual(6);
    expect(either.length).toBeGreaterThanOrEqual(3);
    expect(open.length).toBeGreaterThanOrEqual(3);
  });

  it.each(staffOnly)(
    "$key: a student gets 403, no session 401, staff are let in",
    async (route) => {
      const as = await sessions();
      const student = await callAs(route, as.student);
      expect(student.status).toBe(403);
      expect(student.body).toMatchObject({ error: { code: "FORBIDDEN" } });
      expect((await callAs(route, undefined)).status).toBe(401);
      // Staff get past the role check; what the handler then says (404 for a made-up id, 400 for no body) is its own.
      expect([401, 403]).not.toContain((await callAs(route, as.staff)).status);
    },
  );

  it.each(studentOnly)(
    "$key: staff get 403, no session 401, a student is let in",
    async (route) => {
      const as = await sessions();
      const staff = await callAs(route, as.staff);
      expect(staff.status).toBe(403);
      expect(staff.body).toMatchObject({ error: { code: "FORBIDDEN" } });
      expect((await callAs(route, undefined)).status).toBe(401);
      expect([401, 403]).not.toContain((await callAs(route, as.student)).status);
    },
  );

  it.each(either)("$key: no session 401, either role is let in", async (route) => {
    const as = await sessions();
    expect((await callAs(route, undefined)).status).toBe(401);
    expect([401, 403]).not.toContain((await callAs(route, as.staff)).status);
    expect([401, 403]).not.toContain((await callAs(route, as.student)).status);
  });

  it.each(open)("$key: needs no session", async (route) => {
    const as = await sessions();
    for (const cookie of [undefined, as.staff, as.student]) {
      expect([401, 403]).not.toContain((await callAs(route, cookie)).status);
    }
  });

  it("answers 403 to a student before it reads a body or checks the id", async () => {
    const as = await sessions();
    const { status } = await call(
      routes.find((r) => r.key === "POST /api/marks/publish")!.handler,
      {
        method: "POST",
        path: "/api/marks/publish",
        cookie: as.student,
        body: "{not json",
      },
    );
    expect(status).toBe(403);
  });
});
