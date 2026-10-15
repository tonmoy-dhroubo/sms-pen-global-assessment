import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { GET as downloadRoute } from "@/app/api/files/[fileId]/download/route";
import { db } from "@/lib/db";
import { deletePrefix, putObject } from "@/lib/storage";
import { DOWNLOAD_LINK_SECONDS } from "@/lib/services/files";
import { asStaff, asStudent, call } from "../../support/api";
import { isFilesystemRun } from "../../support/test-storage";
import {
  createAssessment,
  createModule,
  createStaff,
  createStudent,
  createSubmission,
  createSubmissionFile,
} from "../../support/factories";

// GET /api/files/{fileId}/download (api.md "Submissions and files"): staff, or the student who owns the file; anyone
// else gets the same 404 as for a file that does not exist. Real Postgres and real MinIO: the link is fetched.

type Link = { url: string; expiresAt: string };
type ErrorBody = { error: { code: string; message: string } };

const RUN = randomUUID();
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(512)]);

afterAll(() => deletePrefix(`tests/${RUN}/`));

/** A submission with one stored file (the object really exists in the test bucket). */
async function setup(
  options: { fileName?: string; studentStatus?: "ENROLLED" | "WITHDRAWN" } = {},
) {
  const staff = await createStaff();
  const owner = await createStudent({ status: options.studentStatus });
  const other = await createStudent();
  const assessment = await createAssessment({
    moduleId: (await createModule()).id,
    createdById: staff.id,
  });
  const submission = await createSubmission({
    assessmentId: assessment.id,
    studentId: owner.id,
    submittedAt: new Date(),
  });
  const objectKey = `tests/${RUN}/${randomUUID()}.pdf`;
  await putObject(objectKey, PDF, "application/pdf");
  const file = await createSubmissionFile({
    submissionId: submission.id,
    uploadedAt: new Date(),
    objectKey,
    originalName: options.fileName ?? "Final report.pdf",
  });
  return { staff, owner, other, file };
}

function download(fileId: string, cookie?: string) {
  return call<Link & ErrorBody>(downloadRoute, {
    path: `/api/files/${fileId}/download`,
    params: { fileId },
    cookie,
  });
}

describe("GET /api/files/{fileId}/download", () => {
  it("gives staff a link that downloads the file under its original name and lasts five minutes", async () => {
    const { staff, file } = await setup({ fileName: "পোর্টফোলিও.pdf" });

    const before = Date.now();
    const result = await download(file.id, asStaff(staff.id));
    expect(result.status).toBe(200);
    expect(result.response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(result.body).sort()).toEqual(["expiresAt", "url"]);

    const expiresIn = new Date(result.body.expiresAt).getTime() - before;
    expect(DOWNLOAD_LINK_SECONDS).toBe(300);
    expect(expiresIn).toBeGreaterThan(290_000);
    expect(expiresIn).toBeLessThan(310_000);
    // S3 states the lifetime in the URL; the filesystem driver keeps it inside the signed token (relative URL).
    if (!isFilesystemRun()) {
      expect(new URL(result.body.url).searchParams.get("X-Amz-Expires")).toBe("300");
    }

    const fetched = await fetch(result.body.url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PDF)).toBe(true);
    const disposition = fetched.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    // RFC 5987 form carries the Bengali name exactly.
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("পোর্টফোলিও.pdf")}`);
  });

  it("gives the owning student a link, even after they are withdrawn", async () => {
    const { owner, file } = await setup({ studentStatus: "WITHDRAWN" });
    const result = await download(file.id, asStudent(owner.id));
    expect(result.status).toBe(200);
    expect((await fetch(result.body.url)).status).toBe(200);
  });

  it("answers 404 to a different student, exactly as it does for a file that does not exist", async () => {
    const { other, file } = await setup();
    const foreign = await download(file.id, asStudent(other.id));
    const missing = await download(randomUUID(), asStudent(other.id));

    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("NOT_FOUND");
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body); // nothing reveals that the file exists
  });

  it("answers 404 for an unknown or malformed file id, for staff too", async () => {
    const { staff } = await setup();
    expect((await download(randomUUID(), asStaff(staff.id))).status).toBe(404);
    expect((await download("not-a-uuid", asStaff(staff.id))).status).toBe(404);
  });

  it("answers 401 without a session, and for a cookie whose student no longer exists", async () => {
    const { file, other } = await setup();
    const none = await download(file.id);
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe("UNAUTHENTICATED");

    const cookie = asStudent(other.id);
    await db.student.delete({ where: { id: other.id } });
    expect((await download(file.id, cookie)).status).toBe(401);
  });
});
