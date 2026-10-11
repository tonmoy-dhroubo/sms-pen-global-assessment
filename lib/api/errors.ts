import type { ZodError } from "zod";

// API error classes (api.md "Errors"). Services and handlers throw these; `lib/api/handler.ts` turns them into
// the one JSON error shape. Anything that is not an `ApiError` is an unexpected failure and becomes a 500.

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "DUPLICATE_WARNING"
  | "BUSINESS_RULE"
  | "INTERNAL_ERROR";

export abstract class ApiError extends Error {
  abstract readonly status: number;
  abstract readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export interface FieldErrors {
  /** Messages per field. Nested fields use dotted paths (`instalments.0.amount`). */
  fieldErrors: Record<string, string[]>;
  /** Problems with the input as a whole (e.g. a body that is not JSON). */
  formErrors?: string[];
}

/** Flattens a Zod error into `fieldErrors` (dotted paths) and, when present, `formErrors`. */
export function zodToFieldErrors(error: ZodError): FieldErrors {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of error.issues) {
    if (issue.path.length === 0) {
      formErrors.push(issue.message);
      continue;
    }
    const key = issue.path.join(".");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return formErrors.length > 0 ? { fieldErrors, formErrors } : { fieldErrors };
}

/** 400: body or query failed validation. */
export class ValidationError extends ApiError {
  readonly status = 400;
  readonly code = "VALIDATION_ERROR";

  constructor(
    readonly errors: FieldErrors,
    message = "Some fields are invalid.",
  ) {
    super(message, { ...errors });
  }

  static fromZod(error: ZodError, message?: string) {
    return new ValidationError(zodToFieldErrors(error), message);
  }

  /** A single-field problem found by service code rather than a schema. */
  static field(field: string, message: string) {
    return new ValidationError({ fieldErrors: { [field]: [message] } });
  }
}

/** 401: no valid role cookie (missing, tampered, expired, or pointing at a record that is gone). */
export class UnauthenticatedError extends ApiError {
  readonly status = 401;
  readonly code = "UNAUTHENTICATED";

  constructor(message = "Choose who you are viewing as to continue.") {
    super(message);
  }
}

/** 403: a valid session, but the wrong role for this endpoint. */
export class ForbiddenError extends ApiError {
  readonly status = 403;
  readonly code = "FORBIDDEN";

  constructor(message = "You do not have access to this.") {
    super(message);
  }
}

/** 404: the record is missing, or not visible to this student (never reveal that it exists). */
export class NotFoundError extends ApiError {
  readonly status = 404;
  readonly code = "NOT_FOUND";

  constructor(message = "Not found.", details?: Record<string, unknown>) {
    super(message, details);
  }
}

/** 409: a unique clash (email, payment reference); `details` points at the existing record. */
export class ConflictError extends ApiError {
  readonly status = 409;
  readonly code = "CONFLICT";

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

/** 409: the optimistic lock failed (DB-016); the client should reload `details.currentVersion`. */
export class VersionConflictError extends ApiError {
  readonly status = 409;
  readonly code = "VERSION_CONFLICT";

  constructor(
    readonly currentVersion: number,
    message = "This record was changed by someone else. Reload and try again.",
  ) {
    super(message, { currentVersion });
  }
}

/** 409: a probable duplicate student; resend with `confirmDuplicate: true` to proceed. */
export class DuplicateWarning extends ApiError {
  readonly status = 409;
  readonly code = "DUPLICATE_WARNING";

  constructor(
    readonly matches: unknown[],
    message = "A student with the same name and date of birth already exists.",
  ) {
    super(message, { matches });
  }
}

/** 422: valid input that breaks a business rule; `details.rule` names the rule. */
export class BusinessRuleError extends ApiError {
  readonly status = 422;
  readonly code = "BUSINESS_RULE";

  constructor(
    readonly rule: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, { rule, ...details });
  }
}
