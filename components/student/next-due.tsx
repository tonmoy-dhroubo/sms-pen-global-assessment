import { DateTime } from "@/components/format/date-time";
import { daysBetween, todayIn } from "@/lib/services/rules/time";

// "1 Nov 2026 (in 20 days)": the next fee due date and how far away it is, measured from the server's "now" so the
// text is the same on the server and in the browser.

function distance(away: number): string {
  if (away === 0) return "today";
  if (away === 1) return "tomorrow";
  return `in ${away} days`;
}

export function NextDue({ date, now }: { date: string; now: string }) {
  const away = daysBetween(todayIn(new Date(now)), date);
  return (
    <>
      <DateTime value={date} /> ({distance(away)})
    </>
  );
}
