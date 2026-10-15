// With the filesystem storage driver the "presigned" URLs are relative (`/api/uploads/<token>`) and served by the app,
// not by a separate storage server. The integration tests PUT and GET them with plain `fetch`, as a browser would
// against MinIO; there is no HTTP server here, so this routes such a `fetch` straight into the Route Handler.

type FetchInput = Parameters<typeof fetch>[0];

const PREFIX = "/api/uploads/";

function byteLength(body: BodyInit): number {
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  throw new TypeError("Unsupported upload body in a test");
}

export function installStorageFetch(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: FetchInput, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!raw.startsWith(PREFIX)) return realFetch(input, init);

    const route = await import("@/app/api/uploads/[token]/route");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    // A real HTTP client adds Content-Length itself; a `Request` built in memory does not.
    if (init?.body != null && !headers.has("content-length")) {
      headers.set("content-length", String(byteLength(init.body)));
    }
    const request = new Request(`http://localhost:3000${raw}`, {
      method,
      headers,
      body: init?.body ?? undefined,
    });
    const handler = method === "PUT" ? route.PUT : route.GET;
    return handler(request, { params: Promise.resolve({ token: raw.slice(PREFIX.length) }) });
  }) as typeof fetch;
}
