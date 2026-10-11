import { signSessionCookie, SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import type { SessionRole } from "@/lib/session-cookie";
import { TEST_SESSION_SECRET } from "./constants";

// Helpers for calling Route Handlers the way Next.js does: a plain `Request` in, a `Response` out. No HTTP server.

export const BASE_URL = "http://localhost:3000";

/** A `Cookie` header value carrying a correctly signed role cookie. */
export function cookieFor(identity: { role: SessionRole; id: string }, issuedAt?: Date): string {
  return `${SESSION_COOKIE_NAME}=${signSessionCookie(identity, TEST_SESSION_SECRET, issuedAt)}`;
}

export const asStaff = (id: string, issuedAt?: Date) => cookieFor({ role: "staff", id }, issuedAt);
export const asStudent = (id: string, issuedAt?: Date) =>
  cookieFor({ role: "student", id }, issuedAt);

export interface CallOptions {
  method?: string;
  /** Path plus optional query string, e.g. `/api/session/options?q=jos`. */
  path: string;
  /** A `Cookie` header value (see `asStaff` / `asStudent`). */
  cookie?: string;
  /** JSON-encoded unless it is a string, which is sent as-is (for malformed-body tests). */
  body?: unknown;
  headers?: Record<string, string>;
  /** Dynamic route segments, for handlers under `[id]` folders. */
  params?: Record<string, string>;
}

type Handler = (request: Request, context?: { params: Promise<never> }) => Promise<Response>;

export interface ApiResult<T = unknown> {
  response: Response;
  status: number;
  /** Parsed JSON body (`null` when the response has none). */
  body: T;
  /** Every `Set-Cookie` header on the response. */
  setCookies: string[];
}

/** Calls a Route Handler export (`GET`, `PUT`, ...) and reads the response. */
export async function call<T = unknown>(
  handler: unknown,
  options: CallOptions,
): Promise<ApiResult<T>> {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);
  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    headers.set("content-type", "application/json");
  }

  const request = new Request(`${BASE_URL}${options.path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });
  const response = await (handler as Handler)(request, {
    params: Promise.resolve(options.params ?? {}) as Promise<never>,
  });

  const text = await response.text();
  return {
    response,
    status: response.status,
    body: (text ? JSON.parse(text) : null) as T,
    setCookies: response.headers.getSetCookie(),
  };
}

/** The role cookie value out of a `Set-Cookie` header, ready to send back as a `Cookie` header. */
export function cookieFromSetCookie(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}
