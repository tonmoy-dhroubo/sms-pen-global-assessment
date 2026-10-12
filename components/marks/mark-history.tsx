import { DateTime } from "@/components/format/date-time";
import type { MarkHistoryEntry } from "@/lib/services/marks";

// The history of one mark (DB-020, DB-023): who changed it or released it, when, and why. Newest first, as the API
// sends it. A first entry writes no row, so the list can be empty; the entry line names who first entered the mark.

/** A mark value as shown: `NS` for a non-submission, otherwise the one-decimal mark. */
export function markText(value: string | null): string {
  return value === null ? "NS" : value;
}

function describe(entry: MarkHistoryEntry): string {
  switch (entry.change) {
    case "MARK":
      return `Mark changed from ${markText(entry.oldMark)} to ${markText(entry.newMark)}`;
    case "PUBLISH":
      return "Published to the student";
    case "WITHHOLD":
      return "Withheld";
    case "UNPUBLISH":
      return "Unpublished (back to draft)";
  }
}

export function MarkHistory({
  history,
  enteredBy,
  label,
}: {
  history: MarkHistoryEntry[];
  enteredBy: string;
  /** Names the list for assistive technology, e.g. "History of Essay 1". */
  label: string;
}) {
  return (
    <div className="space-y-2 text-sm">
      {history.length === 0 ? (
        <p className="text-muted-foreground">No changes since the mark was entered.</p>
      ) : (
        <ol className="space-y-2" aria-label={label}>
          {history.map((entry) => (
            <li key={entry.id} className="space-y-0.5">
              <div className="font-medium">{describe(entry)}</div>
              <div className="text-xs text-muted-foreground">
                {entry.changedBy.fullName} &middot; <DateTime value={entry.changedAt} />
              </div>
              {entry.reason ? (
                <div className="text-xs">
                  <span className="text-muted-foreground">Reason:</span> {entry.reason}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">First entered by {enteredBy}.</p>
    </div>
  );
}
