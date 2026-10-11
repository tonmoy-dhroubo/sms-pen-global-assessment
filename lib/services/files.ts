import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/api/errors";
import { assertKnownId } from "@/lib/services/ids";
import { presignGet } from "@/lib/storage";

// Downloading a submitted file (api.md "Submissions and files"). The bucket is private (D-012), so a download is a
// short-lived presigned GET that the server only hands out after checking the viewer may see the file: staff can
// open any file, a student only their own. Anyone else gets the same 404 as for a file that does not exist, so the
// response never confirms that another student's file is there.

/** How long a download link works. */
export const DOWNLOAD_LINK_SECONDS = 5 * 60;

export type FileViewer = { role: "staff" } | { role: "student"; studentId: string };

export interface DownloadLink {
  url: string;
  /** When the link stops working (ISO). */
  expiresAt: string;
}

export async function createDownloadLink(
  fileId: string,
  viewer: FileViewer,
): Promise<DownloadLink> {
  assertKnownId(fileId, "File");
  const file = await db.submissionFile.findUnique({
    where: { id: fileId },
    select: { objectKey: true, originalName: true, submission: { select: { studentId: true } } },
  });
  if (!file) throw new NotFoundError("File not found.");
  if (viewer.role === "student" && file.submission.studentId !== viewer.studentId) {
    throw new NotFoundError("File not found.");
  }

  const { url, expiresAt } = await presignGet(
    file.objectKey,
    file.originalName,
    DOWNLOAD_LINK_SECONDS,
  );
  return { url, expiresAt: expiresAt.toISOString() };
}
