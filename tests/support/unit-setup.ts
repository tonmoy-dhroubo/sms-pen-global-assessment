import { format } from "node:util";
import { afterEach, beforeEach, vi } from "vitest";

// Runs before every unit-test file (vitest.config.mts `setupFiles`). In the jsdom (component) tests it turns every
// `console.error` into a test failure.
//
// React reports its own mistakes through `console.error`: invalid DOM nesting such as an <h2> inside an <h2> ("This
// will cause a hydration error"), duplicate keys, state updates outside act(), props on the wrong element. They never
// fail a test by themselves, which is how a nested heading reached the dashboard unnoticed (code review 2026-10-12, #7).
//
// Add to ALLOWED only a message that is truly unavoidable (say, noise from a library the test cannot change), with the
// reason beside it. The list is empty on purpose.
const ALLOWED: { pattern: RegExp; reason: string }[] = [];

if (typeof window !== "undefined") {
  let errors: string[] = [];
  let spy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    errors = [];
    spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const text = format(...args); // fills in React's %s placeholders
      if (!ALLOWED.some(({ pattern }) => pattern.test(text))) errors.push(text);
    });
  });

  afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
    const seen = errors;
    errors = [];
    if (seen.length > 0) {
      throw new Error(
        `console.error was called ${seen.length} time(s) during this test; React and the DOM report real ` +
          `problems this way.\n\n${seen.join("\n\n---\n\n")}`,
      );
    }
  });
}
