import "server-only";
import { Readable } from "node:stream";
import { ForbiddenError, NotFoundError } from "@/lib/api/errors";
import { route } from "@/lib/api/handler";
import { env } from "@/lib/env";
import { filesystemStorage } from "@/lib/storage";
import { contentDisposition, isPendingKey } from "@/lib/storage-core";
import { UploadRejectedError, isSafeKey } from "@/lib/storage-fs";
import { verifyToken } from "@/lib/storage-token";
import type { TokenClaims } from "@/lib/storage-token";

// The filesystem storage driver's stand-in for S3 presigned URLs (D-045). `lib/storage-fs.ts` issues
// `/api/uploads/<token>`; this route is where the browser PUTs the file and, later, GETs it back. There is no session:
// like a presigned URL, the token is the capability. It is signed with SESSION_SECRET, expires, names exactly one key,
// and for an upload also the exact content type and length. With `STORAGE_DRIVER=s3` the route does not exist (404).

type Params = { token: string };

function claimsFor(token: string, expected: TokenClaims["typ"]): TokenClaims {
  // A link that does not verify is "not found", the same answer as a link that never existed.
  const checked = verifyToken(token, env.SESSION_SECRET);
  if (!checked.ok) {
    if (checked.reason === "expired") {
      throw new ForbiddenError("The link has expired. Go back and try again.");
    }
    throw new NotFoundError("Not found.");
  }
  // Only this app signs tokens, so these cannot happen; a token that says otherwise is refused all the same.
  if (checked.claims.typ !== expected || !isSafeKey(checked.claims.key)) {
    throw new NotFoundError("Not found.");
  }
  return checked.claims;
}

/** PUT: store the body at the token's one pending key. */
export const PUT = route<"public", Params>({ access: "public" }, async ({ request, params }) => {
  const storage = filesystemStorage();
  if (!storage) throw new NotFoundError("Not found.");
  const claims = claimsFor(params.token, "put");
  if (claims.typ !== "put" || !isPendingKey(claims.key)) throw new NotFoundError("Not found.");

  // What S3 enforces by signing these two headers, enforced here by comparing them with the signed values.
  const sentType = request.headers.get("content-type");
  const sentLength = request.headers.get("content-length");
  if (sentType !== claims.ct) {
    throw new ForbiddenError(
      "The file type does not match the one this upload link was issued for.",
    );
  }
  if (sentLength === null || !/^\d+$/.test(sentLength) || Number(sentLength) !== claims.len) {
    throw new ForbiddenError(
      "The file size does not match the one this upload link was issued for.",
    );
  }

  try {
    await storage.storeUpload(claims.key, claims.ct, claims.len, request.body);
  } catch (error) {
    if (error instanceof UploadRejectedError) throw new ForbiddenError(error.message);
    throw error;
  }
  return new Response(null, { status: 200 });
});

/** GET: stream the token's object under its download name. */
export const GET = route<"public", Params>({ access: "public" }, async ({ params }) => {
  const storage = filesystemStorage();
  if (!storage) throw new NotFoundError("Not found.");
  const claims = claimsFor(params.token, "get");
  if (claims.typ !== "get") throw new NotFoundError("Not found.");

  const found = await storage.openObject(claims.key);
  if (!found) throw new NotFoundError("File not found.");
  return new Response(Readable.toWeb(found.stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": found.info.contentType ?? "application/octet-stream",
      "Content-Length": String(found.info.sizeBytes),
      "Content-Disposition": contentDisposition(claims.name),
      "X-Content-Type-Options": "nosniff",
    },
  });
});
