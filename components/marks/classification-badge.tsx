import { StatusBadge } from "@/components/shared/status-badge";
import type { Classification } from "@/lib/services/rules/types";

/** A classification badge; a non-submission always reads "NS" (DB-019), whatever its classification. */
export function ClassificationBadge({
  classification,
  isNonSubmission,
  className,
}: {
  classification: Classification;
  isNonSubmission: boolean;
  className?: string;
}) {
  return (
    <StatusBadge
      group="classification"
      value={isNonSubmission ? "NS" : classification}
      className={className}
    />
  );
}
