// @vitest-environment jsdom
import "@/tests/support/dom";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Countdown, formatCountdown } from "@/components/format/countdown";
import { DateTime, RelativeTime } from "@/components/format/date-time";
import { Money } from "@/components/format/money";

describe("Money", () => {
  it.each([
    ["125000", "৳1,25,000.00"],
    ["160000.00", "৳1,60,000.00"],
    ["0", "৳0.00"],
    ["999.5", "৳999.50"],
    ["12345678.9", "৳1,23,45,678.90"],
    ["-2500", "-৳2,500.00"],
  ])("formats %s as %s", (value, expected) => {
    render(<Money value={value} />);
    expect(screen.getByText(expected)).toBeTruthy();
  });
});

describe("DateTime", () => {
  it("shows an instant in Asia/Dhaka time", () => {
    // 17:59 UTC is 23:59 in Dhaka.
    render(<DateTime value="2026-10-11T17:59:00Z" />);
    const element = screen.getByText("11 Oct 2026, 23:59");
    expect(element.tagName).toBe("TIME");
    expect(element.getAttribute("datetime")).toBe("2026-10-11T17:59:00.000Z");
  });

  it("rolls over to the next day in Dhaka", () => {
    render(<DateTime value={new Date("2026-06-30T18:00:00Z")} />);
    expect(screen.getByText("1 Jul 2026, 00:00")).toBeTruthy();
  });

  it("shows only the date when asked", () => {
    render(<DateTime value="2026-10-11T17:59:00Z" dateOnly />);
    expect(screen.getByText("11 Oct 2026")).toBeTruthy();
  });

  it("does not shift a calendar date (YYYY-MM-DD)", () => {
    render(<DateTime value="2026-09-01" />);
    const element = screen.getByText("1 Sep 2026");
    expect(element.getAttribute("datetime")).toBe("2026-09-01");
  });

  it("shows a dash for an unreadable value", () => {
    render(<DateTime value="not a date" />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("RelativeTime", () => {
  const now = "2026-10-11T12:00:00Z";

  it.each([
    ["2026-10-13T12:00:00Z", "in 2 days"],
    ["2026-10-08T12:00:00Z", "3 days ago"],
    ["2026-10-11T07:00:00Z", "5 hours ago"],
    ["2026-10-11T12:00:20Z", "just now"],
  ])("measures %s from the given now as %s", (value, expected) => {
    render(<RelativeTime value={value} now={now} />);
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("puts the exact Dhaka time in the title, and optionally beside the text", () => {
    render(<RelativeTime value="2026-10-13T12:00:00Z" now={now} withExact />);
    const element = screen.getByText("in 2 days (13 Oct 2026, 18:00)");
    expect(element.getAttribute("title")).toBe("13 Oct 2026, 18:00");
  });

  it("shows a dash for an unreadable value", () => {
    render(<RelativeTime value="nope" now={now} />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("formatCountdown", () => {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it.each([
    [2 * DAY + 4 * HOUR + 12 * MINUTE + 33 * SECOND, "2d 4h 12m 33s"],
    [DAY, "1d 0h 0m 0s"],
    [3 * HOUR + 5 * SECOND, "3h 0m 5s"],
    [90 * SECOND, "1m 30s"],
    [45 * SECOND, "45s"],
    [1, "0s"],
  ])("formats %i ms ahead as %s", (remaining, expected) => {
    expect(formatCountdown(remaining)).toBe(expected);
  });

  it.each([
    [0, "Deadline just passed"],
    [-30 * SECOND, "Deadline just passed"],
    [-5 * MINUTE, "Deadline passed 5 minutes ago"],
    [-3 * HOUR, "Deadline passed 3 hours ago"],
    [-2 * DAY, "Deadline passed 2 days ago"],
  ])("formats %i ms past as %s", (remaining, expected) => {
    expect(formatCountdown(remaining)).toBe(expected);
  });
});

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts from the server's now, not the browser's", () => {
    render(<Countdown deadline="2026-10-13T16:12:33Z" serverNow="2026-10-11T12:00:00Z" />);
    expect(screen.getByRole("timer").textContent).toBe("2d 4h 12m 33s");
  });

  it("ticks down once a second", () => {
    render(<Countdown deadline="2026-10-11T12:01:00Z" serverNow="2026-10-11T12:00:00Z" />);
    expect(screen.getByRole("timer").textContent).toBe("1m 0s");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("timer").textContent).toBe("55s");
  });

  it("switches to a passed message when the deadline arrives", () => {
    render(<Countdown deadline="2026-10-11T12:00:03Z" serverNow="2026-10-11T12:00:00Z" />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByRole("timer").textContent).toBe("Deadline just passed");
    expect(screen.getByRole("timer").getAttribute("data-past")).toBe("true");
  });

  it("stops its timer when it unmounts", () => {
    const { unmount } = render(
      <Countdown deadline="2026-10-11T12:01:00Z" serverNow="2026-10-11T12:00:00Z" />,
    );
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a dash for unreadable dates", () => {
    render(<Countdown deadline="nope" serverNow="2026-10-11T12:00:00Z" />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
