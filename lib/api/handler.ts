import "server-only";
import { randomUUID } from "node:crypto";
import type { ZodType, ZodTypeDef } from "zod";
import { logError } from "@/lib/logger";
import { assertSignedIn, assertStaff, assertStudent, identityFromRequest } from "@/lib/session";
import type { Identity, StaffIdentity, StudentIdentity } from "@/lib/session";
import { ApiError, ValidationError } from "./errors";

// The wrapper every Route Handler uses (D-005). It resolves and checks the role, validates the query and body with
// Zod, runs the handler, and turns whatever happens into api.md's response shapes:
//   - a returned value becomes a 200 JSON response (`undefined` becomes 204), with any `warnings` attached;
//   - an `ApiError` becomes its status and the standard `{ error: { code, message, details } }` body;
//   - anything else is logged with a request id and answered with a generic 500.
//
//   export const GET = route({ access: "staff", query: listQuery }, async ({ query, identity }) => {...});

export type Access = "public" | "optional" | "any" | "staff" | "student";

/** What `identity` is for each access level. Role checks happen before the handler runs. */
interface IdentityByAccess {
  /** No session needed; the cookie is not even read. */
  public: null;
  /** Anyone may call; `identity` is the session if there is a valid one. */
  optional: Identity | null;
  /** Staff or student; 401 without a valid session. */
  any: Identity;
  staff: StaffIdentity;
  student: StudentIdentity;
}

export interface Warning {
  code: string;
  message: string;
}

export interface HandlerContext<A extends Access, P, Q, B> {
  request: Request;
  requestId: string;
  /** Dynamic route segments (`/api/students/[id]`). */
  params: P;
  /** Validated query string (`undefined` when the route declares no query schema). */
  query: Q;
  /** Validated JSON body (`undefined` when the route declares no body schema). */
  body: B;
  identity: IdentityByAccess[A];
  /** Adds an entry to the response's `warnings` array (successful responses only). */
  warn: (code: string, message: string) => void;
}

export interface RouteOptions<A extends Access, Q, B> {
  access: A;
  query?: ZodType<Q, ZodTypeDef, unknown>;
  body?: ZodType<B, ZodTypeDef, unknown>;
}

interface ResponseOptions {
  status?: number;
  headers?: HeadersInit;
  /** Full `Set-Cookie` header values. */
  cookies?: string[];
}

/** Return this from a handler to set the status (e.g. 201) or cookies. A plain return value is a 200. */
export class ApiResponse {
  constructor(
    readonly body: unknown,
    readonly options: ResponseOptions = {},
  ) {}
}

export function respond(body: unknown, options?: ResponseOptions): ApiResponse {
  return new ApiResponse(body, options);
}

const REQUEST_ID_HEADER = "x-request-id";

function requestIdFor(request: Request): string {
  // Reuse an id from a proxy or the caller when it looks sane, so logs line up across systems.
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  return incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
}

function baseHeaders(requestId: string, extra?: HeadersInit, cookies?: string[]): Headers {
  const headers = new Headers(extra);
  headers.set(REQUEST_ID_HEADER, requestId);
  // API responses are per-user and always live; never let a browser or CDN reuse them.
  headers.set("Cache-Control", "no-store");
  for (const cookie of cookies ?? []) headers.append("Set-Cookie", cookie);
  return headers;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function successResponse(result: unknown, warnings: Warning[], requestId: string): Response {
  if (result instanceof Response) {
    result.headers.set(REQUEST_ID_HEADER, requestId);
    return result;
  }

  const { body, options } =
    result instanceof ApiResponse ? result : { body: result, options: {} as ResponseOptions };
  const headers = baseHeaders(requestId, options.headers, options.cookies);

  if (body === undefined) return new Response(null, { status: options.status ?? 204, headers });

  // Warnings ride along on object bodies only; lists and scalars have nowhere to put them.
  const payload = warnings.length > 0 && isPlainObject(body) ? { ...body, warnings } : body;
  return Response.json(payload, { status: options.status ?? 200, headers });
}

function errorResponse(error: unknown, request: Request, requestId: string): Response {
  const headers = baseHeaders(requestId);

  if (error instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status, headers },
    );
  }

  logError("Unhandled error in route handler", error, {
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
  });
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
        details: { requestId },
      },
    },
    { status: 500, headers },
  );
}

function resolveAccess(access: Access, identity: Identity | null) {
  switch (access) {
    case "any":
      return assertSignedIn(identity);
    case "staff":
      return assertStaff(identity);
    case "student":
      return assertStudent(identity);
    default:
      return identity;
  }
}

/** Query string to an object; a key that appears more than once becomes an array (`?status=A&status=B`). */
function queryObject(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return query;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError({
      fieldErrors: {},
      formErrors: ["The request body must be valid JSON."],
    });
  }
}

function parseWith<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw ValidationError.fromZod(result.error);
  return result.data;
}

type RouteContext<P> = { params: Promise<P> };

export function route<A extends Access, P = Record<string, never>, Q = undefined, B = undefined>(
  options: RouteOptions<A, Q, B>,
  handler: (context: HandlerContext<A, P, Q, B>) => Promise<unknown> | unknown,
) {
  return async (request: Request, routeContext?: RouteContext<P>): Promise<Response> => {
    const requestId = requestIdFor(request);
    try {
      // Role first, so a student hitting a staff endpoint gets 403 whatever they sent (and 401 without a session).
      const identity = options.access === "public" ? null : await identityFromRequest(request);
      const checked = resolveAccess(options.access, identity) as IdentityByAccess[A];

      const query = (
        options.query ? parseWith(options.query, queryObject(new URL(request.url))) : undefined
      ) as Q;
      const body = (
        options.body ? parseWith(options.body, await readJsonBody(request)) : undefined
      ) as B;
      const params = (routeContext ? await routeContext.params : {}) as P;

      const warnings: Warning[] = [];
      const result = await handler({
        request,
        requestId,
        params,
        query,
        body,
        identity: checked,
        warn: (code, message) => warnings.push({ code, message }),
      });
      return successResponse(result, warnings, requestId);
    } catch (error) {
      return errorResponse(error, request, requestId);
    }
  };
}
