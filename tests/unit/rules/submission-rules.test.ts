import { describe, expect, it } from "vitest";
import {
  canUpload,
  type UploadAssessment,
  type UploadStudent,
} from "@/lib/services/rules/submission-rules";

const deadline = new Date("2026-10-11T17:59:00.000Z");
const before = new Date("2026-10-10T10:00:00.000Z");
const after = new Date("2026-10-12T10:00:00.000Z");

const student: UploadStudent = { status: "ENROLLED", programmeModuleIds: ["mod-1", "mod-2"] };
const assessment: UploadAssessment = { moduleId: "mod-1", deadline };

describe("canUpload", () => {
  it("allows an enrolled student on time", () => {
    expect(canUpload(student, assessment, null, before)).toEqual({ allowed: true, late: false });
    expect(canUpload(student, assessment, undefined, before)).toEqual({
      allowed: true,
      late: false,
    });
  });

  it("allows a replacement before the deadline", () => {
    const existing = { lastSubmittedAt: new Date("2026-10-09T10:00:00.000Z") };
    expect(canUpload(student, assessment, existing, before)).toEqual({
      allowed: true,
      late: false,
    });
  });

  it("allows an upload at exactly the deadline instant (not late)", () => {
    expect(canUpload(student, assessment, null, deadline)).toEqual({ allowed: true, late: false });
  });

  it("accepts a first submission after the deadline and flags it late", () => {
    expect(canUpload(student, assessment, null, new Date(deadline.getTime() + 1))).toEqual({
      allowed: true,
      late: true,
    });
    expect(canUpload(student, assessment, null, after)).toEqual({ allowed: true, late: true });
  });

  describe("NOT_ENROLLED", () => {
    it.each(["DEFERRED", "WITHDRAWN", "COMPLETED"] as const)("blocks a %s student", (status) => {
      expect(canUpload({ ...student, status }, assessment, null, before)).toEqual({
        allowed: false,
        reason: "NOT_ENROLLED",
      });
    });
  });

  describe("MODULE_NOT_IN_PROGRAMME", () => {
    it("blocks when the module is not in the student's programme", () => {
      expect(canUpload(student, { ...assessment, moduleId: "mod-9" }, null, before)).toEqual({
        allowed: false,
        reason: "MODULE_NOT_IN_PROGRAMME",
      });
      expect(canUpload({ ...student, programmeModuleIds: [] }, assessment, null, before)).toEqual({
        allowed: false,
        reason: "MODULE_NOT_IN_PROGRAMME",
      });
    });
  });

  describe("CLOSED", () => {
    const closed = { ...assessment, closedAt: new Date("2026-10-10T08:00:00.000Z") };

    it("blocks all uploads once closed, before or after the deadline", () => {
      expect(canUpload(student, closed, null, before)).toEqual({
        allowed: false,
        reason: "CLOSED",
      });
      expect(canUpload(student, closed, null, after)).toEqual({ allowed: false, reason: "CLOSED" });
    });

    it("blocks replacements too", () => {
      const existing = { lastSubmittedAt: new Date("2026-10-09T10:00:00.000Z") };
      expect(canUpload(student, closed, existing, before)).toEqual({
        allowed: false,
        reason: "CLOSED",
      });
    });

    it("allows uploads again once reopened (closedAt cleared)", () => {
      expect(canUpload(student, { ...closed, closedAt: null }, null, before)).toEqual({
        allowed: true,
        late: false,
      });
    });
  });

  describe("ON_TIME_LOCKED", () => {
    const onTime = { lastSubmittedAt: new Date("2026-10-11T10:00:00.000Z") };

    it("locks an on-time submission once the deadline has passed", () => {
      expect(canUpload(student, assessment, onTime, new Date(deadline.getTime() + 1))).toEqual({
        allowed: false,
        reason: "ON_TIME_LOCKED",
      });
      expect(canUpload(student, assessment, onTime, after)).toEqual({
        allowed: false,
        reason: "ON_TIME_LOCKED",
      });
    });

    it("treats a submission made exactly at the deadline as on time, so it locks", () => {
      expect(canUpload(student, assessment, { lastSubmittedAt: deadline }, after)).toEqual({
        allowed: false,
        reason: "ON_TIME_LOCKED",
      });
    });

    it("does not lock at exactly the deadline instant", () => {
      expect(canUpload(student, assessment, onTime, deadline)).toEqual({
        allowed: true,
        late: false,
      });
    });

    it("lets a late submission be replaced after the deadline (still late)", () => {
      const late = { lastSubmittedAt: new Date(deadline.getTime() + 60_000) };
      expect(canUpload(student, assessment, late, after)).toEqual({ allowed: true, late: true });
    });

    it("uses the student's extension: the same upload is allowed inside it", () => {
      const extended = { ...assessment, extensionDeadline: new Date("2026-10-18T17:59:00.000Z") };
      expect(canUpload(student, extended, onTime, after)).toEqual({ allowed: true, late: false });
      // Past the extension it locks again, and a submission made after the original deadline but inside the
      // extension counts as on time.
      const inExtension = { lastSubmittedAt: new Date("2026-10-13T10:00:00.000Z") };
      expect(
        canUpload(student, extended, inExtension, new Date("2026-10-19T00:00:00.000Z")),
      ).toEqual({
        allowed: false,
        reason: "ON_TIME_LOCKED",
      });
    });
  });

  describe("reason precedence", () => {
    it("reports NOT_ENROLLED before the other reasons", () => {
      const closed = { ...assessment, moduleId: "mod-9", closedAt: before };
      expect(canUpload({ ...student, status: "WITHDRAWN" }, closed, null, after)).toEqual({
        allowed: false,
        reason: "NOT_ENROLLED",
      });
    });

    it("reports MODULE_NOT_IN_PROGRAMME before CLOSED", () => {
      expect(
        canUpload(student, { ...assessment, moduleId: "mod-9", closedAt: before }, null, after),
      ).toEqual({
        allowed: false,
        reason: "MODULE_NOT_IN_PROGRAMME",
      });
    });

    it("reports CLOSED before ON_TIME_LOCKED", () => {
      const onTime = { lastSubmittedAt: new Date("2026-10-11T10:00:00.000Z") };
      expect(canUpload(student, { ...assessment, closedAt: before }, onTime, after)).toEqual({
        allowed: false,
        reason: "CLOSED",
      });
    });
  });
});
