"use client";

import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadLinkRequest } from "@/lib/client/assessments";
import { handleApiError } from "@/lib/client/api-errors";

// Downloads one submitted file. The bucket is private, so the button first asks the API for a short-lived link
// (`GET /api/files/{id}/download`; staff or the owner only) and then follows it. The link carries the original file
// name, so the browser saves the file under the name the student gave it.

export interface DownloadButtonProps {
  fileId: string;
  /** The original file name, used to label the button for assistive technology. */
  fileName: string;
  variant?: "outline" | "ghost" | "secondary";
}

export function DownloadButton({ fileId, fileName, variant = "outline" }: DownloadButtonProps) {
  const [pending, setPending] = useState(false);

  async function download() {
    setPending(true);
    try {
      const link = await downloadLinkRequest(fileId);
      const anchor = document.createElement("a");
      anchor.href = link.url;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      handleApiError(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={pending}
      aria-label={`Download ${fileName}`}
      onClick={download}
    >
      {pending ? (
        <Loader2Icon className="animate-spin" aria-hidden="true" />
      ) : (
        <DownloadIcon data-icon="inline-start" aria-hidden="true" />
      )}
      Download
    </Button>
  );
}
