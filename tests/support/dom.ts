import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Shared setup for component tests (files that opt in with `// @vitest-environment jsdom`). Import it first.
//
// jsdom lacks a few browser APIs that Radix UI and cmdk rely on; these stubs only have to exist, not behave.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof window !== "undefined") {
  window.ResizeObserver ??= ResizeObserverStub;
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.setPointerCapture ??= () => {};
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => cleanup());

/** A JSON `Response` for a mocked `fetch`. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The standard API error body (api.md "Errors"). */
export function apiErrorBody(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): { error: { code: string; message: string; details?: Record<string, unknown> } } {
  return { error: { code, message, ...(details ? { details } : {}) } };
}
