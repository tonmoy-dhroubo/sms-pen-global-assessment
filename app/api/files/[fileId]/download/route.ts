import { route } from "@/lib/api/handler";
import { createDownloadLink } from "@/lib/services/files";

type Params = { fileId: string };

// Staff, or the student who owns the file. Answers a presigned GET link that lives five minutes; a file that is not
// the caller's is a 404, exactly like one that does not exist.
export const GET = route<"any", Params>({ access: "any" }, ({ params, identity }) =>
  createDownloadLink(
    params.fileId,
    identity.role === "staff"
      ? { role: "staff" }
      : { role: "student", studentId: identity.student.id },
  ),
);
