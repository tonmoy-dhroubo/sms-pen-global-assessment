import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// A button that downloads a CSV export (`/api/exports/...`, api.md "Exports"). It is a plain link: the browser sends the
// session cookie, the server answers with `Content-Disposition: attachment`, and the file saves under the name the
// server chose. No script is involved, so it works as soon as the page is shown.

export interface ExportCsvButtonProps {
  href: string;
  /** Accessible name; it starts with the visible text, e.g. "Export CSV: overdue list". */
  label: string;
  className?: string;
}

export function ExportCsvButton({ href, label, className }: ExportCsvButtonProps) {
  return (
    <Button asChild variant="outline" className={className}>
      <a href={href} download aria-label={label}>
        <DownloadIcon data-icon="inline-start" aria-hidden="true" />
        Export CSV
      </a>
    </Button>
  );
}
