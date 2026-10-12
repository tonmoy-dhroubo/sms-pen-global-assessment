import { route } from "@/lib/api/handler";
import { issueUploadUrl } from "@/lib/services/submissions";
import { uploadUrlSchema, type UploadUrlInput } from "@/lib/validation/submissions";

type Params = { id: string };

// Step 1 of an upload (D-013): students only. Checks the file name and type, the size limit and the upload rules, then
// answers a presigned PUT for a key the server chose, valid for 15 minutes. The file itself goes straight to storage.
export const POST = route<"student", Params, undefined, UploadUrlInput>(
  { access: "student", body: uploadUrlSchema },
  ({ params, body, identity }) => issueUploadUrl(identity.student.id, params.id, body),
);
