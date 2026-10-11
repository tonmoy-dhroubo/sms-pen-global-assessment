import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocx, buildPdf } from "@/db/seed/fixture-builders";
import { createRng } from "@/db/seed/rng";
import { addDays, createTimeline, dateColumn, dhakaInstant } from "@/db/seed/timeline";
import { formatDateTime, sessionFor, todayIn, zonedParts } from "@/lib/services/rules/time";

describe("seed rng", () => {
  it("gives the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(
      Array.from({ length: 20 }, () => b.next()),
    );
  });

  it("differs for a different seed and stays inside [0, 1)", () => {
    const a = createRng(1);
    const b = createRng(2);
    const first = Array.from({ length: 20 }, () => a.next());
    expect(first).not.toEqual(Array.from({ length: 20 }, () => b.next()));
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("int() includes both ends and nothing outside", () => {
    const rng = createRng();
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(3, 6)));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it("pick() returns an element and refuses an empty list", () => {
    const rng = createRng();
    expect(["a", "b", "c"]).toContain(rng.pick(["a", "b", "c"]));
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});

describe("seed timeline", () => {
  // 12 Oct 2026, 02:32 in Dhaka: the middle of the night, when "today" differs from the UTC date.
  const now = new Date("2026-10-11T20:32:10Z");
  const tl = createTimeline(now);

  it("takes today and the session from the Dhaka calendar, not UTC", () => {
    expect(tl.today).toBe("2026-10-12");
    expect(tl.sessionYear).toBe(2026);
    expect(sessionFor(now)).toBe("2026-27");
  });

  it("builds Dhaka wall-clock instants (UTC+6)", () => {
    const deadline = tl.at(-21, 23, 59);
    expect(deadline.toISOString()).toBe("2026-09-21T17:59:00.000Z");
    expect(zonedParts(deadline)).toMatchObject({ day: 21, month: 9, hour: 23, minute: 59 });
    expect(formatDateTime(deadline)).toBe("21 Sep 2026, 23:59");
  });

  it("day() and addDays() move across month and year ends", () => {
    expect(tl.day(-40)).toBe("2026-09-02");
    expect(tl.day(80)).toBe("2026-12-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("round-trips through todayIn() whatever the machine's zone", () => {
    expect(todayIn(dhakaInstant("2026-01-01", 0, 0))).toBe("2026-01-01");
    expect(todayIn(dhakaInstant("2026-01-01", 23, 59))).toBe("2026-01-01");
  });

  it("starts each session on 1 July, Dhaka time", () => {
    expect(tl.sessionStart(0).toISOString()).toBe("2026-06-30T18:00:00.000Z");
    expect(zonedParts(tl.sessionStart(2))).toMatchObject({ year: 2024, month: 7, day: 1, hour: 0 });
  });

  it("starts the new session on 1 July and the old one on 30 June", () => {
    expect(createTimeline(dhakaInstant("2026-07-01", 0, 1)).sessionYear).toBe(2026);
    expect(createTimeline(dhakaInstant("2026-06-30", 23, 59)).sessionYear).toBe(2025);
  });

  it("dateColumn() is UTC midnight of the calendar date, as Prisma expects for a date column", () => {
    expect(dateColumn("2026-09-02").toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });
});

describe("seed fixtures", () => {
  const dir = path.resolve("db/seed/fixtures");

  it("the committed files are exactly what the generator builds", () => {
    expect(readFileSync(path.join(dir, "sample.pdf")).equals(buildPdf())).toBe(true);
    expect(readFileSync(path.join(dir, "sample.docx")).equals(buildDocx())).toBe(true);
  });

  it("the PDF has the signature the upload check looks for and a valid cross-reference table", () => {
    const pdf = buildPdf();
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-6).toString("latin1")).toBe("%%EOF\n");
    const text = pdf.toString("latin1");
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...text.matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });

  it("the DOCX is a ZIP holding word/document.xml and no macros", () => {
    const docx = buildDocx();
    expect([...docx.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = docx.toString("latin1");
    for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
      expect(text).toContain(part);
    }
    expect(docx.toString("latin1")).not.toMatch(/vbaProject|macro/i);
  });
});
