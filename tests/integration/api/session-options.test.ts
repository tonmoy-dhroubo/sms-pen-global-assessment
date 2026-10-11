import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/session/options/route";
import { call } from "../../support/api";
import { createProgramme, createStaff, createStudent } from "../../support/factories";

type Options = {
  staff: { id: string; fullName: string; jobTitle: string }[];
  students: {
    items: { id: string; studentNumber: string; fullName: string; status: string }[];
    total: number;
  };
};
type ErrorBody = { error: { code: string; details?: { fieldErrors: Record<string, string[]> } } };

const names = (options: Options) => options.students.items.map((s) => s.fullName);

describe("GET /api/session/options", () => {
  it("is open to anyone and lists staff and students, sorted", async () => {
    await createStaff({ fullName: "Tahmina Akter", jobTitle: "Registrar" });
    await createStaff({ fullName: "Rafiq Hasan", jobTitle: "Registry Officer" });
    const programme = await createProgramme();
    await createStudent({ fullName: "Zara Khan", programmeId: programme.id });
    await createStudent({
      fullName: "Ayesha Rahman",
      programmeId: programme.id,
      status: "DEFERRED",
    });

    const { status, body } = await call<Options>(GET, { path: "/api/session/options" });
    expect(status).toBe(200);
    expect(body.staff.map((s) => s.fullName)).toEqual(["Rafiq Hasan", "Tahmina Akter"]);
    expect(body.staff[0]).toEqual({
      id: expect.any(String),
      fullName: "Rafiq Hasan",
      jobTitle: "Registry Officer",
    });
    expect(names(body)).toEqual(["Ayesha Rahman", "Zara Khan"]);
    expect(body.students.total).toBe(2);
    expect(body.students.items[0]).toEqual({
      id: expect.any(String),
      studentNumber: expect.stringMatching(/^SMS-2026-\d{4}$/),
      fullName: "Ayesha Rahman",
      status: "DEFERRED",
    });
  });

  it("returns empty lists when there is nothing", async () => {
    const { body } = await call<Options>(GET, { path: "/api/session/options" });
    expect(body).toEqual({ staff: [], students: { items: [], total: 0 } });
  });

  it("does not expose contact details or dates of birth", async () => {
    await createStaff();
    await createStudent();
    const { body } = await call<Options>(GET, { path: "/api/session/options" });
    expect(JSON.stringify(body)).not.toMatch(/@sms\.test|dateOfBirth|email/);
  });

  describe("?q=", () => {
    async function seed() {
      const programme = await createProgramme();
      for (const fullName of [
        "José Álvarez",
        "Jose Smith",
        "Fatima Begum",
        "Md. Jose-Luis Rahman",
        "50% Discount",
      ]) {
        await createStudent({ fullName, programmeId: programme.id });
      }
    }

    it("matches names ignoring case and accents (DB-021)", async () => {
      await seed();
      for (const q of ["jose", "JOSE", "josé", "ÁLVAREZ", "alvarez"]) {
        const { body } = await call<Options>(GET, {
          path: `/api/session/options?q=${encodeURIComponent(q)}`,
        });
        expect(names(body), `q=${q}`).toContain("José Álvarez");
      }
      const { body } = await call<Options>(GET, { path: "/api/session/options?q=jose" });
      expect(names(body)).toEqual(["José Álvarez", "Jose Smith", "Md. Jose-Luis Rahman"]);
      expect(body.students.total).toBe(3);
    });

    it("matches part of a name and part of a Student ID", async () => {
      await seed();
      const byName = await call<Options>(GET, { path: "/api/session/options?q=begu" });
      expect(names(byName.body)).toEqual(["Fatima Begum"]);

      const target = (await call<Options>(GET, { path: "/api/session/options?q=fatima" })).body
        .students.items[0]!;
      const suffix = target.studentNumber.slice(-4);
      const byNumber = await call<Options>(GET, { path: `/api/session/options?q=${suffix}` });
      expect(byNumber.body.students.items.map((s) => s.id)).toContain(target.id);
      const full = await call<Options>(GET, {
        path: `/api/session/options?q=${target.studentNumber.toLowerCase()}`,
      });
      expect(full.body.students.items.map((s) => s.id)).toEqual([target.id]);
    });

    it("treats % and _ as plain characters, not wildcards", async () => {
      await seed();
      const percent = await call<Options>(GET, { path: "/api/session/options?q=50%25" });
      expect(names(percent.body)).toEqual(["50% Discount"]);
      const underscore = await call<Options>(GET, { path: "/api/session/options?q=_" });
      expect(underscore.body.students.items).toEqual([]);
      const wildcard = await call<Options>(GET, { path: "/api/session/options?q=%25" });
      expect(names(wildcard.body)).toEqual(["50% Discount"]);
    });

    it("is safe against SQL in the search text", async () => {
      await seed();
      const { status, body } = await call<Options>(GET, {
        path: `/api/session/options?q=${encodeURIComponent("'; DROP TABLE students; --")}`,
      });
      expect(status).toBe(200);
      expect(body.students.items).toEqual([]);
      const after = await call<Options>(GET, { path: "/api/session/options" });
      expect(after.body.students.total).toBe(5);
    });

    it("ignores surrounding spaces and returns everyone for a blank query", async () => {
      await seed();
      const padded = await call<Options>(GET, { path: "/api/session/options?q=%20%20fatima%20" });
      expect(names(padded.body)).toEqual(["Fatima Begum"]);
      const blank = await call<Options>(GET, { path: "/api/session/options?q=%20%20" });
      expect(blank.body.students.total).toBe(5);
    });

    it("returns no students, but still all staff, when nothing matches", async () => {
      await seed();
      await createStaff({ fullName: "Rafiq Hasan" });
      const { body } = await call<Options>(GET, { path: "/api/session/options?q=zzzz" });
      expect(body.students).toEqual({ items: [], total: 0 });
      expect(body.staff).toHaveLength(1);
    });
  });

  describe("limit", () => {
    it("defaults to 20, reports the full total and keeps the sort order", async () => {
      const programme = await createProgramme();
      for (let i = 0; i < 25; i++) {
        await createStudent({
          fullName: `Student ${String(i).padStart(2, "0")}`,
          programmeId: programme.id,
        });
      }
      const { body } = await call<Options>(GET, { path: "/api/session/options" });
      expect(body.students.items).toHaveLength(20);
      expect(body.students.total).toBe(25);
      expect(body.students.items[0]!.fullName).toBe("Student 00");
      expect(body.students.items[19]!.fullName).toBe("Student 19");
    });

    it("honours ?limit= up to 50", async () => {
      const programme = await createProgramme();
      for (let i = 0; i < 6; i++) {
        await createStudent({ fullName: `Student ${i}`, programmeId: programme.id });
      }
      const { body } = await call<Options>(GET, { path: "/api/session/options?limit=3" });
      expect(body.students.items).toHaveLength(3);
      expect(body.students.total).toBe(6);
    });

    it.each(["0", "51", "-1", "abc", "2.5"])("rejects limit=%s with 400", async (limit) => {
      const { status, body } = await call<ErrorBody>(GET, {
        path: `/api/session/options?limit=${limit}`,
      });
      expect(status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(body.error.details!.fieldErrors)).toEqual(["limit"]);
    });

    it("rejects an over-long search with 400", async () => {
      const { status } = await call(GET, { path: `/api/session/options?q=${"a".repeat(101)}` });
      expect(status).toBe(400);
    });
  });
});
