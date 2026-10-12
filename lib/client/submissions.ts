import { apiRequest } from "@/lib/client/api";
import type { Receipt, UploadUrlResult } from "@/lib/services/submissions";
import type { UploadUrlInput } from "@/lib/validation/submissions";

// Browser calls behind the upload panel (api.md "Submissions and files"): ask for an upload URL, PUT the file straight
// to storage with progress, then confirm. Type-only imports above: nothing server-side is bundled.

export type { Receipt, UploadUrlResult };

export function requestUploadUrl(
  assessmentId: string,
  body: UploadUrlInput,
  signal?: AbortSignal,
): Promise<UploadUrlResult> {
  return apiRequest<UploadUrlResult>(`/api/assessments/${assessmentId}/submission/upload-url`, {
    method: "POST",
    body,
    signal,
  });
}

export function confirmUploadRequest(
  assessmentId: string,
  pendingUploadId: string,
  signal?: AbortSignal,
): Promise<Receipt> {
  return apiRequest<Receipt>(`/api/assessments/${assessmentId}/submission/confirm`, {
    method: "POST",
    body: { pendingUploadId },
    signal,
  });
}

/** Why the PUT to storage did not complete. `refused` is a 4xx/5xx answer; `network` a dropped connection. */
export class StorageUploadError extends Error {
  constructor(
    readonly kind: "refused" | "network" | "aborted",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StorageUploadError";
  }
}

export interface StorageUploadOptions {
  url: string;
  /** Exactly the headers the API returned: the URL signs them, so adding or changing one breaks the signature. */
  headers: Record<string, string>;
  file: Blob;
  /** Called with 0-100 as bytes go out. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * PUTs the file to the presigned URL with `XMLHttpRequest` (the only browser API that reports upload progress). The
 * browser adds `Content-Length` itself from the file, which is one of the signed headers.
 */
export function uploadToStorage(options: StorageUploadOptions): Promise<void> {
  const { url, headers, file, onProgress, signal } = options;
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(
          new StorageUploadError(
            "refused",
            request.status === 403
              ? "Storage refused the file. The upload link may have expired; try again."
              : `Storage answered with an error (HTTP ${request.status}). Try again.`,
            request.status,
          ),
        );
      }
    };
    request.onerror = () => {
      reject(
        new StorageUploadError(
          "network",
          "The upload was interrupted. Check your connection and try again.",
        ),
      );
    };
    request.onabort = () => reject(new StorageUploadError("aborted", "Upload cancelled."));

    if (signal) {
      if (signal.aborted) {
        reject(new StorageUploadError("aborted", "Upload cancelled."));
        return;
      }
      signal.addEventListener("abort", () => request.abort(), { once: true });
    }
    request.send(file);
  });
}
