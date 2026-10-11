// @vitest-environment jsdom
import "@/tests/support/dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DeadlineInput, deadlineInstant } from "@/components/assessments/deadline-input";
import { toDeadlineFields, toDeadlineInstant } from "@/lib/validation/assessments";

// The deadline is typed on a clock in Asia/Dhaka (UTC+6) and stored in UTC. These tests pin the round trip: what is
// typed becomes the right UTC instant, a stored instant reads back as the same Dhaka date and time, and the UI says
// which time zone it means.

const NOW = "2026-10-12T04:00:00.000Z";

function Harness({ initial }: { initial: string }) {
  const start = toDeadlineFields(initial);
  const [date, setDate] = useState(start.deadlineDate);
  const [time, setTime] = useState(start.deadlineTime);
  return (
    <>
      <DeadlineInput
        idPrefix="d"
        date={date}
        time={time}
        onDateChange={setDate}
        onTimeChange={setTime}
        now={NOW}
      />
      <output data-testid="instant">{deadlineInstant(date, time)?.toISOString() ?? "none"}</output>
    </>
  );
}

describe("Dhaka time round-trip", () => {
  it("23:59 in Dhaka is 17:59 UTC, and a stored instant reads back as the same Dhaka date and time", () => {
    expect(toDeadlineInstant("2026-10-11", "23:59")).toBe("2026-10-11T17:59:00.000Z");
    expect(toDeadlineFields("2026-10-11T17:59:00.000Z")).toEqual({
      deadlineDate: "2026-10-11",
      deadlineTime: "23:59",
    });
    // An instant just after midnight UTC is already the next morning in Dhaka.
    expect(toDeadlineFields("2026-10-11T20:30:00Z")).toEqual({
      deadlineDate: "2026-10-12",
      deadlineTime: "02:30",
    });
  });

  it("shows the stored instant as Dhaka date and time, with the time zone named", () => {
    render(<Harness initial="2026-10-11T17:59:00.000Z" />);

    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-11");
    expect((screen.getByLabelText("Time (24-hour)") as HTMLInputElement).value).toBe("23:59");
    expect(screen.getByText(/Asia\/Dhaka time/)).toBeTruthy();
    expect(screen.getByText(/UTC\+6/)).toBeTruthy();
    const preview = document.querySelector("[data-slot=deadline-preview]")!;
    expect(preview.textContent).toContain("11 Oct 2026, 23:59 (Asia/Dhaka)");
    expect(preview.textContent).toContain("2026-10-11 17:59 UTC");
    expect(screen.getByTestId("instant").textContent).toBe("2026-10-11T17:59:00.000Z");
  });

  it("turns what is typed into the matching UTC instant", () => {
    render(<Harness initial="2026-10-11T17:59:00.000Z" />);

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("Time (24-hour)"), { target: { value: "08:30" } });

    expect(screen.getByTestId("instant").textContent).toBe("2026-12-31T02:30:00.000Z");
    const preview = document.querySelector("[data-slot=deadline-preview]")!;
    expect(preview.textContent).toContain("31 Dec 2026, 08:30 (Asia/Dhaka)");
    expect(preview.textContent).toContain("2026-12-31 02:30 UTC");
  });

  it("says so when the deadline is in the past, and not when it is ahead", () => {
    const { unmount } = render(<Harness initial="2026-10-11T17:59:00.000Z" />); // before NOW
    expect(screen.getByText(/This deadline is in the past/)).toBeTruthy();
    unmount();

    render(<Harness initial="2026-10-20T17:59:00.000Z" />);
    expect(screen.queryByText(/This deadline is in the past/)).toBeNull();
  });

  it("asks for a date and time while either is missing or not real", () => {
    render(<Harness initial="2026-10-11T17:59:00.000Z" />);
    fireEvent.change(screen.getByLabelText("Time (24-hour)"), { target: { value: "" } });
    expect(screen.getByText("Choose a date and a time.")).toBeTruthy();
    expect(screen.getByTestId("instant").textContent).toBe("none");
  });

  it("shows field problems under the right field", () => {
    render(
      <DeadlineInput
        idPrefix="d"
        date=""
        time=""
        onDateChange={() => {}}
        onTimeChange={() => {}}
        dateError="Choose the deadline date."
        timeError="Enter the time as HH:mm, for example 23:59."
      />,
    );
    expect(screen.getByLabelText("Date").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Choose the deadline date.")).toBeTruthy();
    expect(screen.getByLabelText("Time (24-hour)").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter the time as HH:mm, for example 23:59.")).toBeTruthy();
  });
});
