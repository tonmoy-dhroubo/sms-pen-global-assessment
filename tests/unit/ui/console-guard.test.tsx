// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// tests/support/unit-setup.ts fails any jsdom test that calls console.error (React's hydration and DOM-nesting
// warnings arrive that way). A failing test cannot be asserted from inside Vitest, so this only checks the guard is
// switched on: console.error is replaced by a spy in every component test.
describe("console.error guard (code review #7)", () => {
  it("is active in component tests", () => {
    expect(vi.isMockFunction(console.error)).toBe(true);
  });
});
