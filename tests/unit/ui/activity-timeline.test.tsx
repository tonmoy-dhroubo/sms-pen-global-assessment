// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityTimeline, groupByDay } from "@/components/students/activity-timeline";
import type { StudentTimeline, TimelineEvent } from "@/lib/services/timeline";

const STAFF = { id: "st1", fullName: "Kamrul Hasan" };

// "Now" is 12 Oct 2026, 14:00 in Dhaka (08:00 UTC).
const NOW = "2026-10-12T08:00:00.000Z";

function event(
  overrides: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "at">,
): TimelineEvent {
  return {
    type: "PAYMENT_RECORDED",
    actor: STAFF,
    summary: PAYMENT_SUMMARY,
    details: {},
    ...overrides,
  };
}

const PAYMENT_SUMMARY = "Payment recorded: ৳15,000.00 by cash, reference RCPT-1";
const TODAY_PAYMENT = event({ id: "payment:1", at: "2026-10-12T05:30:00.000Z" });
const YESTERDAY_WITHHELD = event({
  id: "mark:2",
  at: "2026-10-11T09:00:00.000Z",
  type: "MARK_WITHHELD",
  summary: "Result withheld: Essay 1",
  details: { reason: "Outstanding fees" },
  href: "/staff/assessments/a1",
});
// 23:30 UTC on 9 Oct is 05:30 on 10 Oct in Dhaka: the next calendar day there.
const LATE_EVENING = event({
  id: "status:3",
  at: "2026-10-09T23:30:00.000Z",
  type: "STATUS_CHANGE",
  summary: "Status changed from Enrolled to Deferred",
  details: { reason: "Medical leave" },
});
const SUBMISSION = event({
  id: "submission:4",
  at: "2026-09-01T10:00:00.000Z",
  type: "SUBMISSION",
  actor: null,
  summary: "Submitted Essay 1 (essay.pdf), late by 2 hours",
  details: { late: true },
});

afterEach(() => vi.unstubAllGlobals());

describe("groupByDay", () => {
  it("groups by calendar day in Dhaka, with Today and Yesterday named", () => {
    const days = groupByDay([TODAY_PAYMENT, YESTERDAY_WITHHELD, LATE_EVENING, SUBMISSION], NOW);
    expect(days.map((d) => [d.date, d.heading, d.events.length])).toEqual([
      ["2026-10-12", "Today", 1],
      ["2026-10-11", "Yesterday", 1],
      ["2026-10-10", "10 Oct 2026", 1],
      ["2026-09-01", "1 Sep 2026", 1],
    ]);
  });

  it("keeps several events of one day together, in the order given", () => {
    const earlier = event({ id: "payment:0", at: "2026-10-12T01:00:00.000Z" });
    const days = groupByDay([TODAY_PAYMENT, earlier], NOW);
    expect(days).toHaveLength(1);
    expect(days[0]!.events.map((e) => e.id)).toEqual(["payment:1", "payment:0"]);
  });

  it("makes no groups out of no events", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});

describe("ActivityTimeline", () => {
  const first: StudentTimeline = {
    items: [TODAY_PAYMENT, YESTERDAY_WITHHELD, SUBMISSION],
    nextBefore: SUBMISSION.at,
  };

  it("shows events grouped by day with icon label, actor, times and reason", () => {
    render(<ActivityTimeline studentId="s1" initial={first} now={NOW} />);

    const today = screen.getByRole("heading", { name: /Today/ });
    expect(today.textContent).toContain("12 Oct 2026");
    const paymentItem = screen.getByText(PAYMENT_SUMMARY).closest("li")!;
    expect(
      within(paymentItem).getByText("Payment recorded:", { selector: ".sr-only" }),
    ).toBeTruthy();
    expect(paymentItem.textContent).toContain("By Kamrul Hasan");
    // 05:30 UTC is 11:30 in Dhaka; the relative phrase is measured from the server's "now".
    expect(within(paymentItem).getByText("11:30")).toBeTruthy();
    expect(within(paymentItem).getByText("2 hours ago")).toBeTruthy();

    const yesterday = screen.getByRole("heading", { name: /Yesterday/ });
    expect(yesterday).toBeTruthy();
    const withheld = screen.getByRole("link", { name: "Result withheld: Essay 1" });
    expect(withheld.getAttribute("href")).toBe("/staff/assessments/a1");
    expect(withheld.closest("li")!.textContent).toContain("Reason: Outstanding fees");

    // A student's own upload has no staff actor, and says it was late.
    const submitted = screen.getByText(/Submitted Essay 1/).closest("li")!;
    expect(submitted.textContent).not.toContain("By ");
    expect(submitted.textContent).toContain("Late");
  });

  it("explains an empty timeline", () => {
    render(<ActivityTimeline studentId="s1" initial={{ items: [], nextBefore: null }} now={NOW} />);
    expect(screen.getByText("No activity yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Load older/ })).toBeNull();
  });

  it("loads older events from the cursor, appends them and then stops offering more", async () => {
    const older = event({
      id: "charge:5",
      at: "2026-08-20T04:00:00.000Z",
      type: "FEE_CHARGE",
      summary: "Fee charged: Tuition (৳40,000.00)",
    });
    const fetchMock = vi.fn(async () =>
      jsonResponse({ items: [SUBMISSION, older], nextBefore: null } satisfies StudentTimeline),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ActivityTimeline studentId="s1" initial={first} now={NOW} />);

    await user.click(screen.getByRole("button", { name: "Load older events" }));

    await screen.findByText("Fee charged: Tuition (৳40,000.00)");
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
    expect(url).toBe(`/api/students/s1/timeline?before=${encodeURIComponent(SUBMISSION.at)}`);
    // The event that was on both pages is shown once.
    expect(screen.getAllByText(/Submitted Essay 1/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Load older/ })).toBeNull();
    expect(screen.getByText("That is everything on record.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loaded 2 older events.");
  });

  it("keeps what it has and offers a retry when loading older events fails", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fail
          ? jsonResponse(apiErrorBody("INTERNAL_ERROR", "Could not read the history."), 500)
          : jsonResponse({ items: [], nextBefore: null }),
      ),
    );
    const user = userEvent.setup();
    render(<ActivityTimeline studentId="s1" initial={first} now={NOW} />);

    await user.click(screen.getByRole("button", { name: "Load older events" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not read the history.");
    expect(screen.getByText(PAYMENT_SUMMARY)).toBeTruthy();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("button", { name: /Load older|Try again/ })).toBeNull();
  });

  describe("after the server refreshes the page (code review #5)", () => {
    const NEW_PAYMENT = event({
      id: "payment:9",
      at: "2026-10-12T07:00:00.000Z",
      summary: "Payment recorded: ৳5,000.00 by bkash, reference RCPT-9",
    });

    it("shows an event that arrives with a new first page", () => {
      const { rerender } = render(<ActivityTimeline studentId="s1" initial={first} now={NOW} />);
      expect(screen.queryByText(NEW_PAYMENT.summary)).toBeNull();

      rerender(
        <ActivityTimeline
          studentId="s1"
          initial={{ items: [NEW_PAYMENT, ...first.items], nextBefore: first.nextBefore }}
          now={NOW}
        />,
      );

      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items[0]).toContain("RCPT-9");
      expect(items).toHaveLength(4);
    });

    it("keeps the older events already loaded, and does not offer them again", async () => {
      const older = event({
        id: "charge:5",
        at: "2026-08-20T04:00:00.000Z",
        type: "FEE_CHARGE",
        summary: "Fee charged: Tuition (৳40,000.00)",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({ items: [older], nextBefore: null } satisfies StudentTimeline),
        ),
      );
      const user = userEvent.setup();
      const { rerender } = render(<ActivityTimeline studentId="s1" initial={first} now={NOW} />);
      await user.click(screen.getByRole("button", { name: "Load older events" }));
      await screen.findByText(older.summary);
      expect(screen.getByText("That is everything on record.")).toBeTruthy();

      // The refreshed first page is shifted by the new event: the last event of the old page falls off its end.
      rerender(
        <ActivityTimeline
          studentId="s1"
          initial={{
            items: [NEW_PAYMENT, TODAY_PAYMENT, YESTERDAY_WITHHELD],
            nextBefore: YESTERDAY_WITHHELD.at,
          }}
          now={NOW}
        />,
      );

      expect(screen.getByText(NEW_PAYMENT.summary)).toBeTruthy();
      expect(screen.getByText(older.summary)).toBeTruthy();
      expect(screen.getAllByText(/Submitted Essay 1/)).toHaveLength(1);
      // Everything older was already loaded, so there is nothing more to fetch.
      expect(screen.queryByRole("button", { name: /Load older/ })).toBeNull();
      expect(screen.getByText("That is everything on record.")).toBeTruthy();
    });

    it("keeps offering older events when none were loaded before the refresh", () => {
      const { rerender } = render(<ActivityTimeline studentId="s1" initial={first} now={NOW} />);
      rerender(
        <ActivityTimeline
          studentId="s1"
          initial={{
            items: [NEW_PAYMENT, TODAY_PAYMENT, YESTERDAY_WITHHELD],
            nextBefore: YESTERDAY_WITHHELD.at,
          }}
          now={NOW}
        />,
      );
      // The event the new page pushed past its end stays visible; the button is still there for what lies beyond.
      expect(screen.getByText(/Submitted Essay 1/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Load older events" })).toBeTruthy();
    });

    it("starts over when the page switches to another student", () => {
      const { rerender } = render(<ActivityTimeline studentId="s1" initial={first} now={NOW} />);
      rerender(
        <ActivityTimeline
          studentId="s2"
          initial={{ items: [NEW_PAYMENT], nextBefore: null }}
          now={NOW}
        />,
      );
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(screen.queryByText(PAYMENT_SUMMARY)).toBeNull();
    });
  });
});
