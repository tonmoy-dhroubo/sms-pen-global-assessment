import { describe, expect, it } from "vitest";
import {
  assessmentFormSchema,
  assessmentListQuerySchema,
  createAssessmentSchema,
  updateAssessmentSchema,
} from "@/lib/validation/assessments";

const MODULE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function messages(result: {
  success: boolean;
  error?: { issues: { path: (string | number)[]; message: string }[] };
}) {
  return Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));
}

describe("createAssessmentSchema", () => {
  it("reads the deadline as an instant, whatever offset it is written with", () => {
    const utc = createAssessmentSchema.parse({
      moduleId: MODULE_ID,
      title: "Essay",
      deadline: "2026-10-11T17:59:00Z",
    });
    const dhaka = createAssessmentSchema.parse({
      moduleId: MODULE_ID,
      title: "Essay",
      deadline: "2026-10-11T23:59:00+06:00",
    });
    expect(utc.deadline.toISOString()).toBe("2026-10-11T17:59:00.000Z");
    expect(dhaka.deadline.getTime()).toBe(utc.deadline.getTime());
  });

  it("trims the title and collapses spaces", () => {
    expect(
      createAssessmentSchema.parse({
        moduleId: MODULE_ID,
        title: "  Case   Study  1 ",
        deadline: "2026-10-11T17:59:00Z",
      }).title,
    ).toBe("Case Study 1");
  });

  it("rejects a title that is blank or too long, a bad module, and a deadline without an offset", () => {
    const bad = createAssessmentSchema.safeParse({
      moduleId: "nope",
      title: "   ",
      deadline: "2026-10-11T23:59:00",
    });
    expect(bad.success).toBe(false);
    expect(messages(bad)).toMatchObject({
      moduleId: "Choose a module.",
      title: "Enter a title.",
    });
    expect(messages(bad).deadline).toMatch(/ISO 8601/);
    expect(
      createAssessmentSchema.safeParse({
        moduleId: MODULE_ID,
        title: "x".repeat(201),
        deadline: "2026-10-11T17:59:00Z",
      }).success,
    ).toBe(false);
  });

  it("rejects deadlines outside 2000-2099", () => {
    for (const deadline of [
      "1999-12-31T23:59:00Z",
      "2100-01-01T00:00:00Z",
      "0026-10-11T17:59:00Z",
    ]) {
      const result = createAssessmentSchema.safeParse({
        moduleId: MODULE_ID,
        title: "x",
        deadline,
      });
      expect(result.success, deadline).toBe(false);
    }
  });
});

describe("updateAssessmentSchema", () => {
  it("needs the version and at least one field", () => {
    expect(updateAssessmentSchema.safeParse({ title: "x" }).success).toBe(false);
    const nothing = updateAssessmentSchema.safeParse({ version: 1 });
    expect(nothing.success).toBe(false);
    expect(nothing.error?.issues[0]?.message).toBe("Change at least one field.");
    expect(updateAssessmentSchema.safeParse({ title: "x", version: 0 }).success).toBe(false);
    expect(updateAssessmentSchema.safeParse({ title: "x", version: 2 }).success).toBe(true);
  });

  it("accepts any single field", () => {
    expect(
      updateAssessmentSchema.safeParse({ deadline: "2026-10-11T17:59:00Z", version: 1 }).success,
    ).toBe(true);
    expect(updateAssessmentSchema.safeParse({ moduleId: MODULE_ID, version: 1 }).success).toBe(
      true,
    );
  });
});

describe("assessmentFormSchema (Dhaka date and time)", () => {
  const valid = {
    moduleId: MODULE_ID,
    title: "Essay",
    deadlineDate: "2026-10-11",
    deadlineTime: "23:59",
  };

  it("accepts a real date and a 24-hour time", () => {
    expect(assessmentFormSchema.safeParse(valid).success).toBe(true);
    expect(assessmentFormSchema.safeParse({ ...valid, deadlineTime: "00:00" }).success).toBe(true);
  });

  it("explains each problem under its own field", () => {
    const result = assessmentFormSchema.safeParse({
      moduleId: "",
      title: "",
      deadlineDate: "2026-02-30",
      deadlineTime: "25:00",
    });
    expect(messages(result)).toMatchObject({
      moduleId: "Choose a module.",
      title: "Enter a title.",
      deadlineDate: "Enter a real calendar date.",
      deadlineTime: "Enter the time as HH:mm, for example 23:59.",
    });
    expect(
      messages(assessmentFormSchema.safeParse({ ...valid, deadlineDate: "" })).deadlineDate,
    ).toBe("Choose the deadline date.");
  });

  it("rejects a date in the wrong century", () => {
    const result = assessmentFormSchema.safeParse({ ...valid, deadlineDate: "2100-01-01" });
    expect(messages(result).deadlineDate).toMatch(/between the years 2000 and 2099/);
  });
});

describe("assessmentListQuerySchema", () => {
  it("defaults to page 1 of 25, and accepts the state and module filters", () => {
    expect(assessmentListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(
      assessmentListQuerySchema.parse({
        state: "past-deadline",
        moduleId: MODULE_ID,
        sort: "-title",
      }),
    ).toMatchObject({
      state: "past-deadline",
      moduleId: MODULE_ID,
      sort: { field: "title", direction: "desc" },
    });
  });

  it("rejects an unknown state, sort field, module id and oversized page", () => {
    for (const query of [
      { state: "done" },
      { sort: "students" },
      { moduleId: "x" },
      { pageSize: "101" },
      { page: "0" },
    ]) {
      expect(assessmentListQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });
});
