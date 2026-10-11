import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiRequest } from "@/lib/client/api";

function respond(body: unknown, status = 200, raw = false): Response {
  return new Response(raw ? (body as string) : JSON.stringify(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("returns the parsed JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ role: "staff" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/api/session")).resolves.toEqual({ role: "staff" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/session",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("sends a JSON body with the right header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ role: "student" }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/session", { method: "PUT", body: { role: "student", studentId: "x" } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"role":"student","studentId":"x"}');
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("turns the standard error body into an ApiRequestError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respond(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Some fields are invalid.",
              details: {
                fieldErrors: {
                  email: ["Enter a valid email address."],
                  name: ["Required", "Too short"],
                },
                formErrors: ["Body was wrong."],
              },
            },
          },
          400,
        ),
      ),
    );

    const error = (await apiRequest("/api/students", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    )) as ApiRequestError;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Some fields are invalid.");
    expect(error.fieldErrors).toEqual({
      email: ["Enter a valid email address."],
      name: ["Required", "Too short"],
    });
    expect(error.formErrors).toEqual(["Body was wrong."]);
    expect(error.requestId).toBeNull();
  });

  it("exposes the request id of a 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respond(
          {
            error: {
              code: "INTERNAL_ERROR",
              message: "Unexpected.",
              details: { requestId: "req-1" },
            },
          },
          500,
        ),
      ),
    );
    const error = (await apiRequest("/api/x").catch((e: unknown) => e)) as ApiRequestError;
    expect(error.requestId).toBe("req-1");
    expect(error.fieldErrors).toEqual({});
    expect(error.formErrors).toEqual([]);
  });

  it("copes with an error response that is not our JSON shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respond("<html>Bad gateway</html>", 502, true)),
    );
    const error = (await apiRequest("/api/x").catch((e: unknown) => e)) as ApiRequestError;
    expect(error.code).toBe("UNKNOWN");
    expect(error.status).toBe(502);
    expect(error.message).toContain("HTTP 502");
  });

  it("reports a network failure as NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = (await apiRequest("/api/x").catch((e: unknown) => e)) as ApiRequestError;
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.status).toBe(0);
  });

  it("lets a cancelled request through as an AbortError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
    await expect(apiRequest("/api/x")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns null for an empty success body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiRequest("/api/x", { method: "DELETE" })).resolves.toBeNull();
  });
});
