import { describe, expect, it } from "vitest";
import { POST as confirmRoute } from "@/app/api/assessments/[id]/submission/confirm/route";
import { POST as uploadUrlRoute } from "@/app/api/assessments/[id]/submission/upload-url/route";
import { GET as downloadRoute } from "@/app/api/files/[fileId]/download/route";
import { GET as myAssessmentsRoute } from "@/app/api/me/assessments/route";
import { GET as mySubmissionRoute } from "@/app/api/me/assessments/[id]/submission/route";
import { GET as myFeesRoute } from "@/app/api/me/fees/route";
import { GET as myResultsRoute } from "@/app/api/me/results/route";
import { GET as meRoute } from "@/app/api/me/route";
import { db } from "@/lib/db";
import { call } from "../../support/api";
import { expectNothingOfOthers, world } from "../../support/world";
import type { World } from "../../support/world";

// The access-control item of edge-cases.md: a student cannot read or change another student's data by changing an ID in
// the URL, the query string or the body. For every student-facing endpoint this suite signs in as one student and aims
// at another's records; the answer is a 404 that matches the one for a record that does not exist (so nothing confirms
// the record is there), or the id is ignored and only the signed-in student's own data comes back.

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const PDF = { fileName: "work.pdf", contentType: "application/pdf", sizeBytes: 2048 };

describe("GET /api/me* ignore ids that are not the signed-in student's", () => {
  const TAMPER = (w: World) =>
    `?studentId=${w.peer.id}&id=${w.peer.id}&student=${w.stranger.id}&studentNumber=${w.peer.studentNumber}`;

  it("GET /api/me returns the signed-in student whatever the query says", async () => {
    const w = await world();
    const { status, body } = await call<{ student: { id: string } }>(meRoute, {
      path: `/api/me${TAMPER(w)}`,
      cookie: w.cookie,
    });
    expect(status).toBe(200);
    expect(body.student.id).toBe(w.me.id);
    expectNothingOfOthers(w, body);
  });

  it("GET /api/me/fees returns only my own fees", async () => {
    const w = await world();
    const { status, body } = await call(myFeesRoute, {
      path: `/api/me/fees${TAMPER(w)}`,
      cookie: w.cookie,
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ charges: [], payments: [], summary: { feeState: "paid" } });
    expectNothingOfOthers(w, body);
  });

  it("GET /api/me/assessments lists only assessments of my programme, with no one else's files", async () => {
    const w = await world();
    const { status, body } = await call<{ items: { id: string; submission: unknown }[] }>(
      myAssessmentsRoute,
      { path: `/api/me/assessments${TAMPER(w)}`, cookie: w.cookie },
    );
    expect(status).toBe(200);
    expect(body.items.map((item) => item.id)).toEqual([w.shared.id]);
    expect(body.items[0]!.submission).toBeNull(); // the peer submitted to it, I have not
    expectNothingOfOthers(w, body);
  });

  it("GET /api/me/results shows my assessments only, never a peer's published mark", async () => {
    const w = await world();
    const { status, body } = await call<{
      items: { status: string; assessment: { id: string } }[];
    }>(myResultsRoute, { path: `/api/me/results${TAMPER(w)}`, cookie: w.cookie });
    expect(status).toBe(200);
    expect(body.items.map((item) => [item.assessment.id, item.status])).toEqual([
      [w.shared.id, "NOT_AVAILABLE"],
    ]);
    expectNothingOfOthers(w, body);
  });
});

describe("GET /api/me/assessments/{id}/submission", () => {
  const detail = (id: string, cookie: string, query = "") =>
    call<{ assessment: { id: string; submission: unknown } } & ErrorBody>(mySubmissionRoute, {
      path: `/api/me/assessments/${id}/submission${query}`,
      params: { id },
      cookie,
    });

  it("is a 404, identical to an unknown id, for an assessment of another programme", async () => {
    const w = await world();
    const foreign = await detail(w.foreign.id, w.cookie);
    const unknown = await detail(UNKNOWN, w.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("NOT_FOUND");
    expect(foreign.body).toEqual(unknown.body);
    expectNothingOfOthers(w, foreign.body);
  });

  it("is a 404 for ids that are not assessments, such as someone's submission or file id", async () => {
    const w = await world();
    for (const id of [w.peerFile.id, w.pending.id, w.peer.id, "not-a-uuid"]) {
      expect((await detail(id, w.cookie)).status).toBe(404);
    }
  });

  it("shows my own (empty) submission to a shared assessment, never the peer's, even with ?studentId=", async () => {
    const w = await world();
    const { status, body } = await detail(w.shared.id, w.cookie, `?studentId=${w.peer.id}`);
    expect(status).toBe(200);
    expect(body.assessment.id).toBe(w.shared.id);
    expect(body.assessment.submission).toBeNull();
    expectNothingOfOthers(w, body);
  });
});

describe("GET /api/files/{fileId}/download", () => {
  const download = (fileId: string, cookie: string, query = "") =>
    call<ErrorBody>(downloadRoute, {
      path: `/api/files/${fileId}/download${query}`,
      params: { fileId },
      cookie,
    });

  it("is a 404, identical to an unknown file, for a peer's file and a stranger's file", async () => {
    const w = await world();
    const unknown = await download(UNKNOWN, w.cookie);
    for (const file of [w.peerFile, w.strangerFile]) {
      const result = await download(file.id, w.cookie, `?studentId=${file.id}&as=${w.peer.id}`);
      expect(result.status).toBe(404);
      expect(result.body).toEqual(unknown.body);
    }
  });
});

describe("POST /api/assessments/{id}/submission/upload-url", () => {
  const issue = (assessmentId: string, cookie: string, body: unknown) =>
    call<{ pendingUploadId: string } & ErrorBody>(uploadUrlRoute, {
      method: "POST",
      path: `/api/assessments/${assessmentId}/submission/upload-url`,
      params: { id: assessmentId },
      cookie,
      body,
    });

  it("refuses an assessment whose module is not in my programme, and records nothing", async () => {
    const w = await world();
    const before = await db.pendingUpload.count();
    const result = await issue(w.foreign.id, w.cookie, PDF);
    expect(result.status).toBe(422);
    expect(result.body.error.details).toMatchObject({ rule: "MODULE_NOT_IN_PROGRAMME" });
    expect(await db.pendingUpload.count()).toBe(before);
  });

  it("is a 404 for an unknown assessment id", async () => {
    const w = await world();
    expect((await issue(UNKNOWN, w.cookie, PDF)).status).toBe(404);
  });

  it("ignores a student id in the body: the upload is always mine", async () => {
    const w = await world();
    const result = await issue(w.shared.id, w.cookie, {
      ...PDF,
      studentId: w.peer.id,
      student: { id: w.peer.id },
    });
    expect(result.status).toBe(200);
    const row = await db.pendingUpload.findUniqueOrThrow({
      where: { id: result.body.pendingUploadId },
    });
    expect(row.studentId).toBe(w.me.id);
    expect(row.objectKey).toContain(`/${w.me.id}/`);
    expect(row.objectKey).not.toContain(w.peer.id);
  });
});

describe("POST /api/assessments/{id}/submission/confirm", () => {
  const confirm = (assessmentId: string, cookie: string, body: unknown) =>
    call<ErrorBody>(confirmRoute, {
      method: "POST",
      path: `/api/assessments/${assessmentId}/submission/confirm`,
      params: { id: assessmentId },
      cookie,
      body,
    });

  it("is a 404, identical to an unknown pending upload, for someone else's pendingUploadId", async () => {
    const w = await world();
    const unknown = await confirm(w.shared.id, w.cookie, { pendingUploadId: UNKNOWN });
    expect(unknown.status).toBe(404);

    const before = await db.submissionFile.count();
    const aimed = await confirm(w.shared.id, w.cookie, {
      pendingUploadId: w.pending.id,
      studentId: w.peer.id,
    });
    expect(aimed.status).toBe(404);
    expect(aimed.body).toEqual(unknown.body);

    // Nothing was confirmed, deleted or recorded on the peer's behalf.
    const row = await db.pendingUpload.findUniqueOrThrow({ where: { id: w.pending.id } });
    expect(row.confirmedAt).toBeNull();
    expect(await db.submissionFile.count()).toBe(before);
  });

  it("is a 404 when the pending upload is the peer's but the assessment in the URL is another", async () => {
    const w = await world();
    const result = await confirm(w.foreign.id, w.cookie, { pendingUploadId: w.pending.id });
    expect(result.status).toBe(404);
  });
});
