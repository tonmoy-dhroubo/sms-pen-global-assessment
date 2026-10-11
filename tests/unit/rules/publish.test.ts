import { describe, expect, it } from "vitest";
import { buildPublishPreview, type PublishMark } from "@/lib/services/rules/publish";
import type { ReleaseStatus } from "@/lib/services/rules/types";

const A1 = "assess-1";
const mark = (
  studentId: string,
  releaseStatus: ReleaseStatus = "DRAFT",
  assessmentId = A1,
): PublishMark => ({
  markId: `${studentId}:${assessmentId}`,
  studentId,
  assessmentId,
  releaseStatus,
});

describe("buildPublishPreview", () => {
  it("a clean publish has no warnings", () => {
    const preview = buildPublishPreview({
      marks: [mark("s1"), mark("s2")],
      expected: [
        { studentId: "s1", assessmentId: A1 },
        { studentId: "s2", assessmentId: A1 },
      ],
      overdueStudents: [],
    });
    expect(preview.toPublish).toBe(2);
    expect(preview.alreadyPublished).toBe(0);
    expect(preview.missingMarks).toEqual([]);
    expect(preview.overdueStudents).toEqual([]);
    expect(preview.overdueTotal.toFixed(2)).toBe("0.00");
    expect(preview.warnings).toEqual([]);
    expect(preview.summary).toBe("Publish 2 marks");
  });

  it("counts DRAFT and WITHHELD for publishing and leaves PUBLISHED alone", () => {
    const preview = buildPublishPreview({
      marks: [mark("s1", "DRAFT"), mark("s2", "WITHHELD"), mark("s3", "PUBLISHED")],
      expected: [],
      overdueStudents: [],
    });
    expect(preview.toPublish).toBe(2);
    expect(preview.alreadyPublished).toBe(1);
  });

  it("lists students expected to have a mark but without one", () => {
    const preview = buildPublishPreview({
      marks: [mark("s1")],
      expected: [
        { studentId: "s1", assessmentId: A1 },
        { studentId: "s2", assessmentId: A1 },
        { studentId: "s3", assessmentId: A1 },
      ],
      overdueStudents: [],
    });
    expect(preview.missingMarks).toEqual([
      { studentId: "s2", assessmentId: A1 },
      { studentId: "s3", assessmentId: A1 },
    ]);
    expect(preview.warnings).toEqual([{ code: "MISSING_MARKS", message: "2 marks missing." }]);
    expect(preview.summary).toBe("Publish 1 mark - 2 marks missing");
  });

  it("matches missing marks per assessment as well as per student", () => {
    const preview = buildPublishPreview({
      marks: [mark("s1", "DRAFT", "a1")],
      expected: [
        { studentId: "s1", assessmentId: "a1" },
        { studentId: "s1", assessmentId: "a2" },
      ],
      overdueStudents: [],
    });
    expect(preview.missingMarks).toEqual([{ studentId: "s1", assessmentId: "a2" }]);
    expect(preview.warnings[0]!.message).toBe("1 mark missing.");
  });

  it("warns about students with overdue fees who have marks to publish", () => {
    const preview = buildPublishPreview({
      marks: [mark("s1"), mark("s2"), mark("s2", "DRAFT", "a2"), mark("s3")],
      expected: [],
      overdueStudents: [
        { studentId: "s2", overdueAmount: "40000.00" },
        { studentId: "s3", overdueAmount: "10000.50" },
      ],
    });
    expect(
      preview.overdueStudents.map((s) => [
        s.studentId,
        s.marksToPublish,
        s.overdueAmount.toFixed(2),
      ]),
    ).toEqual([
      ["s2", 2, "40000.00"],
      ["s3", 1, "10000.50"],
    ]);
    expect(preview.overdueTotal.toFixed(2)).toBe("50000.50");
    expect(preview.warnings).toEqual([
      { code: "OVERDUE_FEES", message: "2 students have overdue fees." },
    ]);
    expect(preview.summary).toBe("Publish 4 marks - 2 students have overdue fees");
  });

  it("uses the singular for one student", () => {
    const preview = buildPublishPreview({
      marks: [mark("s1")],
      expected: [],
      overdueStudents: [{ studentId: "s1", overdueAmount: "1" }],
    });
    expect(preview.warnings[0]!.message).toBe("1 student has overdue fees.");
    expect(preview.summary).toBe("Publish 1 mark - 1 student has overdue fees");
  });

  it("ignores overdue students with nothing to publish or nothing actually overdue", () => {
    const preview = buildPublishPreview({
      marks: [mark("s1", "PUBLISHED"), mark("s2")],
      expected: [],
      overdueStudents: [
        { studentId: "s1", overdueAmount: "100" }, // already published: not affected by this run
        { studentId: "s9", overdueAmount: "100" }, // no marks in scope
        { studentId: "s2", overdueAmount: "0" }, // nothing overdue
      ],
    });
    expect(preview.overdueStudents).toEqual([]);
    expect(preview.warnings).toEqual([]);
  });

  it("matches the example in edge-cases.md: 18 marks, 2 overdue students, 3 missing", () => {
    const marks = Array.from({ length: 18 }, (_, i) => mark(`s${i + 1}`));
    const expected = [
      ...marks.map((m) => ({ studentId: m.studentId, assessmentId: A1 })),
      { studentId: "x1", assessmentId: A1 },
      { studentId: "x2", assessmentId: A1 },
      { studentId: "x3", assessmentId: A1 },
    ];
    const preview = buildPublishPreview({
      marks,
      expected,
      overdueStudents: [
        { studentId: "s2", overdueAmount: "40000" },
        { studentId: "s7", overdueAmount: "15000" },
      ],
    });
    expect(preview.summary).toBe(
      "Publish 18 marks - 2 students have overdue fees, 3 marks missing",
    );
    expect(preview.warnings.map((w) => w.code)).toEqual(["OVERDUE_FEES", "MISSING_MARKS"]);
  });

  it("handles an empty scope", () => {
    const preview = buildPublishPreview({ marks: [], expected: [], overdueStudents: [] });
    expect(preview.toPublish).toBe(0);
    expect(preview.summary).toBe("Publish 0 marks");
  });
});
