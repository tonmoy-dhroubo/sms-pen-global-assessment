// @vitest-environment jsdom
import "@/tests/support/dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RouteError from "@/app/error";
import StaffLoading from "@/app/staff/loading";
import StudentLoading from "@/app/student/loading";
import NotFound from "@/app/not-found";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { CardGridSkeleton, TableSkeleton } from "@/components/shared/skeletons";

// pages.md "Global layout": every list and panel has a loading state, an empty state with guidance and an error state
// with a retry. The pieces every page shares, checked once here; each list's own empty copy is covered by its tests.

describe("loading states", () => {
  it("the staff and student route fallbacks announce themselves and hide the grey boxes", () => {
    for (const Loading of [StaffLoading, StudentLoading]) {
      const { unmount } = render(<Loading />);
      const region = screen.getByRole("status");
      expect(region.getAttribute("aria-busy")).toBe("true");
      expect(region.textContent).toContain("Loading page");
      unmount();
    }
  });

  it("table and card skeletons carry their own label", () => {
    render(
      <>
        <TableSkeleton label="Loading students" />
        <CardGridSkeleton label="Loading figures" />
      </>,
    );
    expect(screen.getByText("Loading students")).toBeTruthy();
    expect(screen.getByText("Loading figures")).toBeTruthy();
  });
});

describe("empty states", () => {
  it("say what is missing and offer the next step", () => {
    render(
      <EmptyState
        title="No payments yet"
        description="Use Record payment when money arrives."
        action={<button type="button">Record payment</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No payments yet" })).toBeTruthy();
    expect(screen.getByText("Use Record payment when money arrives.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record payment" })).toBeTruthy();
  });

  it("an unknown or forbidden page is a friendly 404 with a way back", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the start" }).getAttribute("href")).toBe("/");
  });
});

describe("error states", () => {
  it("are announced as alerts, show the reference, and retry on request", async () => {
    const retry = vi.fn();
    render(<ErrorState onRetry={retry} reference="abc123" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Reference: abc123")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("the route error boundary re-renders the page when asked", async () => {
    const reset = vi.fn();
    render(<RouteError error={Object.assign(new Error("boom"), { digest: "d1" })} reset={reset} />);
    expect(screen.getByText("Reference: d1")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
