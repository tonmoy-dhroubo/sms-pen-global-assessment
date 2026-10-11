import type { ErrorCode } from "@/lib/api/errors";

// Browser-side fetch wrapper for our own `/api` (api.md "Conventions"). Turns the standard error body into a typed
// `ApiRequestError` so forms and dialogs can react to the code, field errors and details.

export type ClientErrorCode = ErrorCode | "NETWORK_ERROR" | "UNKNOWN";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(options: {
    status: number;
    code: ClientErrorCode;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }

  /** Messages per field for a `VALIDATION_ERROR` (dotted paths for nested fields); empty otherwise. */
  get fieldErrors(): Record<string, string[]> {
    const value = this.details?.fieldErrors;
    if (!value || typeof value !== "object") return {};
    const result: Record<string, string[]> = {};
    for (const [key, messages] of Object.entries(value)) {
      if (Array.isArray(messages)) result[key] = messages.filter((m) => typeof m === "string");
    }
    return result;
  }

  /** Problems with the request as a whole, such as a body that was not JSON. */
  get formErrors(): string[] {
    const value = this.details?.formErrors;
    return Array.isArray(value) ? value.filter((m) => typeof m === "string") : [];
  }

  /** The id to quote when reporting a 500 (`details.requestId`). */
  get requestId(): string | null {
    const value = this.details?.requestId;
    return typeof value === "string" ? value : null;
  }
}

const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  signal?: AbortSignal;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorFromBody(response: Response, body: unknown): ApiRequestError {
  const error =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: Record<string, unknown> }).error
      : undefined;
  if (error && typeof error.code === "string" && typeof error.message === "string") {
    return new ApiRequestError({
      status: response.status,
      code: error.code as ClientErrorCode,
      message: error.message,
      details:
        error.details && typeof error.details === "object"
          ? (error.details as Record<string, unknown>)
          : undefined,
    });
  }
  return new ApiRequestError({
    status: response.status,
    code: "UNKNOWN",
    message: `Something went wrong (HTTP ${response.status}). Try again.`,
  });
}

/** Calls an API route and returns the parsed JSON body; throws `ApiRequestError` on any failure. */
export async function apiRequest<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch (error) {
    // A cancelled request is not a failure the user needs to hear about.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiRequestError({ status: 0, code: "NETWORK_ERROR", message: NETWORK_MESSAGE });
  }

  const body = await parseBody(response);
  if (!response.ok) throw errorFromBody(response, body);
  return body as T;
}
