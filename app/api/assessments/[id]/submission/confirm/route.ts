import { route } from "@/lib/api/handler";
import { confirmUpload } from "@/lib/services/submissions";
import { confirmUploadSchema, type ConfirmUploadInput } from "@/lib/validation/submissions";

type Params = { id: string };

// Step 3 of an upload (D-013): students only. Reads the stored file, checks it, records the version and answers the
// receipt. Repeating the call for the same pending upload answers the same receipt.
export const POST = route<"student", Params, undefined, ConfirmUploadInput>(
  { access: "student", body: confirmUploadSchema },
  ({ params, body, identity }) =>
    confirmUpload(identity.student.id, params.id, body.pendingUploadId),
);
