import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { db } from "@/lib/db";
import { asStudent } from "./api";
import {
  createAssessment,
  createFeeCharge,
  createMark,
  createModule,
  createPayment,
  createProgramme,
  createStaff,
  createStudent,
  createSubmission,
  createSubmissionFile,
  linkModule,
} from "./factories";

// A small world for the access-control suites (edge-cases.md "Cross-cutting"): one signed-in student (`me`) and, around
// them, everything that belongs to other students and must never reach them: a peer in the same programme who has
// submitted, paid, been marked and left an upload unfinished, and a stranger in another programme.

const HOUR = 60 * 60 * 1000;

export type World = Awaited<ReturnType<typeof world>>;

/** Everything another student owns that a curious student might aim at. */
export async function world() {
  const staff = await createStaff();
  const mine = await createProgramme();
  const theirs = await createProgramme();
  const sharedModule = await createModule();
  const otherModule = await createModule();
  await linkModule(mine.id, sharedModule.id);
  await linkModule(theirs.id, otherModule.id);

  const me = await createStudent({ programmeId: mine.id, fullName: "Meher Rahman" });
  // Same programme as me: the shared assessment is also theirs.
  const peer = await createStudent({ programmeId: mine.id, fullName: "Peer Secretname" });
  // A different programme: their assessment is not mine.
  const stranger = await createStudent({ programmeId: theirs.id, fullName: "Stranger Hidden" });

  const deadline = new Date(Date.now() + 24 * HOUR);
  const shared = await createAssessment({
    moduleId: sharedModule.id,
    createdById: staff.id,
    title: "Shared essay",
    deadline,
  });
  const foreign = await createAssessment({
    moduleId: otherModule.id,
    createdById: staff.id,
    title: "Foreign project",
    deadline,
  });

  const peerSubmission = await createSubmission({
    assessmentId: shared.id,
    studentId: peer.id,
    submittedAt: new Date(),
  });
  const peerFile = await createSubmissionFile({
    submissionId: peerSubmission.id,
    uploadedAt: new Date(),
    originalName: "peer-secret-essay.pdf",
    sha256: "d".repeat(64),
  });
  const strangerSubmission = await createSubmission({
    assessmentId: foreign.id,
    studentId: stranger.id,
    submittedAt: new Date(),
  });
  const strangerFile = await createSubmissionFile({
    submissionId: strangerSubmission.id,
    uploadedAt: new Date(),
    originalName: "stranger-secret-project.pdf",
    sha256: "e".repeat(64),
  });

  // The peer's money and marks.
  await createFeeCharge({
    studentId: peer.id,
    amount: "987654.00",
    dueDate: "2026-01-01",
    description: "Peer-only charge",
  });
  const peerPayment = await createPayment({
    studentId: peer.id,
    staffId: staff.id,
    amount: "123.00",
  });
  await createMark({
    assessmentId: shared.id,
    studentId: peer.id,
    enteredById: staff.id,
    mark: "77.7",
    releaseStatus: "PUBLISHED",
  });
  await createMark({
    assessmentId: foreign.id,
    studentId: stranger.id,
    enteredById: staff.id,
    mark: "88.8",
    releaseStatus: "PUBLISHED",
  });

  // Somebody else's unfinished upload.
  const pending = await db.pendingUpload.create({
    data: {
      assessmentId: shared.id,
      studentId: peer.id,
      objectKey: `submissions/${shared.id}/${peer.id}/${randomUUID()}.pdf`,
      originalName: "peer-pending.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  return {
    staff,
    me,
    peer,
    stranger,
    shared,
    foreign,
    peerFile,
    strangerFile,
    peerPayment,
    pending,
    cookie: asStudent(me.id),
  };
}

/** The strings that must never appear in anything the signed-in student receives. */
export function secrets(w: World): string[] {
  return [
    w.peer.id,
    w.peer.studentNumber,
    w.peer.fullName,
    w.peer.email,
    w.stranger.id,
    w.stranger.fullName,
    w.peerFile.id,
    "peer-secret-essay.pdf",
    "d".repeat(64),
    w.strangerFile.id,
    "stranger-secret-project.pdf",
    "e".repeat(64),
    "Peer-only charge",
    w.peerPayment.reference,
    "987654.00",
    "77.7",
    "88.8",
  ];
}

export function expectNothingOfOthers(w: World, body: unknown) {
  const json = JSON.stringify(body);
  for (const secret of secrets(w)) expect(json, `leaked ${secret}`).not.toContain(secret);
}
