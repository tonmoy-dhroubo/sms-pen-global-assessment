import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { ApiRequestError } from "@/lib/client/api";
import type { ClientErrorCode } from "@/lib/client/api";

// One place that decides what a failed API call looks like to the user (api.md "Errors"):
//   - 400 VALIDATION_ERROR: each field's messages go onto that form field; anything the form does not show, and
//     form-level problems, become a toast.
//   - everything else: a Sonner toast with the server's message (a 500 also shows the request id to quote).
// Codes in `passthrough` (VERSION_CONFLICT, DUPLICATE_WARNING, CONFLICT, ...) are left for the caller, which has a
// dedicated dialog or inline message for them.

export type ApiErrorOutcome = "fields" | "toast" | "passthrough";

export interface HandleApiErrorOptions<TFieldValues extends FieldValues> {
  /** `form.setError` of the react-hook-form instance the request came from. */
  setError?: UseFormSetError<TFieldValues>;
  /** Names of the fields the form actually shows; other field errors are toasted. Omit to try every field. */
  fields?: readonly string[];
  /** Error codes the caller handles itself; nothing is shown for them. */
  passthrough?: readonly ClientErrorCode[];
  /** Used when `error` is not an `ApiRequestError`. */
  fallbackMessage?: string;
}

const UNEXPECTED = "Something went wrong. Try again.";

export function handleApiError<TFieldValues extends FieldValues = FieldValues>(
  error: unknown,
  options: HandleApiErrorOptions<TFieldValues> = {},
): ApiErrorOutcome {
  if (!(error instanceof ApiRequestError)) {
    toast.error(options.fallbackMessage ?? UNEXPECTED);
    return "toast";
  }

  if (options.passthrough?.includes(error.code)) return "passthrough";

  if (error.code === "VALIDATION_ERROR") return handleValidation(error, options);

  if (error.code === "UNAUTHENTICATED") {
    toast.error("Your session has ended.", {
      description: "Choose who you are viewing as to continue.",
    });
    return "toast";
  }

  if (error.code === "INTERNAL_ERROR" && error.requestId) {
    toast.error(error.message, { description: `Reference: ${error.requestId}` });
    return "toast";
  }

  toast.error(error.message);
  return "toast";
}

function handleValidation<TFieldValues extends FieldValues>(
  error: ApiRequestError,
  options: HandleApiErrorOptions<TFieldValues>,
): ApiErrorOutcome {
  const leftovers: string[] = [...error.formErrors];
  let placed = 0;

  for (const [path, messages] of Object.entries(error.fieldErrors)) {
    const shown = options.setError && (!options.fields || options.fields.includes(path));
    if (shown && options.setError) {
      options.setError(
        path as FieldPath<TFieldValues>,
        { type: "server", message: messages.join(" ") },
        // Focus the first field with a problem so keyboard users land on it.
        { shouldFocus: placed === 0 },
      );
      placed += 1;
    } else {
      leftovers.push(...messages);
    }
  }

  if (leftovers.length > 0) {
    toast.error(leftovers.join(" "));
    return placed > 0 ? "fields" : "toast";
  }
  if (placed > 0) return "fields";

  toast.error(error.message);
  return "toast";
}
