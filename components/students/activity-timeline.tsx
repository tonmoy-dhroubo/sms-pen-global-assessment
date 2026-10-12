"use client";

import {
  ArrowRightLeftIcon,
  BanIcon,
  BanknoteIcon,
  EyeIcon,
  EyeOffIcon,
  FileUpIcon,
  HistoryIcon,
  Loader2Icon,
  PencilLineIcon,
  ReceiptTextIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { RelativeTime } from "@/components/format/date-time";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchTimeline, type StudentTimeline } from "@/lib/client/students";
import { ApiRequestError } from "@/lib/client/api";
import { daysBetween, formatDate, instantToLocalDateTime } from "@/lib/services/rules/time";
import type { TimelineEvent, TimelineEventType } from "@/lib/services/timeline";
import { cn } from "@/lib/utils";

// The Activity timeline section of the student record (pages.md `/staff/students/[id]`): what was done to or for the
// student, newest first, grouped by day in Asia/Dhaka (D-018). Each event has an icon for its kind, who did it, the
// time as a relative phrase and the clock time, and the reason where one was given. The first page arrives with the
// record; "Load older events" follows the cursor (`nextBefore`) of `GET /api/students/{id}/timeline`.

interface TypeDef {
  label: string;
  icon: LucideIcon;
  /** Tone tokens from app/globals.css (D-017), so the circle reads in both themes. */
  tone: string;
}

const TYPES: Record<TimelineEventType, TypeDef> = {
  STATUS_CHANGE: {
    label: "Status change",
    icon: ArrowRightLeftIcon,
    tone: "bg-tone-blue text-tone-blue-foreground",
  },
  FEE_CHARGE: {
    label: "Fee charge",
    icon: ReceiptTextIcon,
    tone: "bg-tone-grey text-tone-grey-foreground",
  },
  PAYMENT_RECORDED: {
    label: "Payment recorded",
    icon: BanknoteIcon,
    tone: "bg-tone-green text-tone-green-foreground",
  },
  PAYMENT_VOIDED: {
    label: "Payment voided",
    icon: BanIcon,
    tone: "bg-tone-red text-tone-red-foreground",
  },
  SUBMISSION: {
    label: "Submission",
    icon: FileUpIcon,
    tone: "bg-tone-blue text-tone-blue-foreground",
  },
  MARK_CHANGED: {
    label: "Mark changed",
    icon: PencilLineIcon,
    tone: "bg-tone-grey text-tone-grey-foreground",
  },
  MARK_PUBLISHED: {
    label: "Result published",
    icon: EyeIcon,
    tone: "bg-tone-green text-tone-green-foreground",
  },
  MARK_WITHHELD: {
    label: "Result withheld",
    icon: EyeOffIcon,
    tone: "bg-tone-amber text-tone-amber-foreground",
  },
  MARK_UNPUBLISHED: {
    label: "Result unpublished",
    icon: Undo2Icon,
    tone: "bg-tone-grey text-tone-grey-foreground",
  },
};

export interface TimelineDay {
  /** `YYYY-MM-DD` in Dhaka. */
  date: string;
  /** "Today", "Yesterday" or the date, for the heading. */
  heading: string;
  events: TimelineEvent[];
}

/** The calendar day (Dhaka) an instant falls on. */
export function dayOf(instant: string): string {
  return instantToLocalDateTime(new Date(instant)).date;
}

/**
 * Groups events (already newest first) into days, keeping their order. `now` decides which days read "Today" and
 * "Yesterday"; any other day shows its date.
 */
export function groupByDay(events: readonly TimelineEvent[], now: string): TimelineDay[] {
  const today = dayOf(now);
  const days: TimelineDay[] = [];
  for (const event of events) {
    const date = dayOf(event.at);
    const last = days[days.length - 1];
    if (last && last.date === date) {
      last.events.push(event);
      continue;
    }
    const ago = daysBetween(date, today);
    days.push({
      date,
      heading: ago === 0 ? "Today" : ago === 1 ? "Yesterday" : formatDate(date),
      events: [event],
    });
  }
  return days;
}

function reasonOf(event: TimelineEvent): string | null {
  const reason = event.details.reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

function TimelineItem({ event, now }: { event: TimelineEvent; now: string }) {
  const def = TYPES[event.type];
  const Icon = def.icon;
  const reason = reasonOf(event);
  const late = event.type === "SUBMISSION" && event.details.late === true;

  return (
    <li className="flex gap-3" data-type={event.type}>
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          def.tone,
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
        <span className="sr-only">{def.label}: </span>
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm break-words">
          {event.href ? (
            <Link href={event.href} className="underline-offset-4 hover:underline">
              {event.summary}
            </Link>
          ) : (
            event.summary
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {event.actor ? <>By {event.actor.fullName} &middot; </> : null}
          <time dateTime={event.at}>{instantToLocalDateTime(new Date(event.at)).time}</time>
          {" · "}
          <RelativeTime value={event.at} now={now} />
          {late ? <span className="font-medium text-foreground"> &middot; Late</span> : null}
        </p>
        {reason ? (
          <p className="text-xs break-words text-muted-foreground">
            <span className="font-medium">Reason:</span> {reason}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export interface ActivityTimelineProps {
  studentId: string;
  /** The first page, read on the server together with the record. */
  initial: StudentTimeline;
  /** The server's clock (ISO), so "Today" and the relative times agree between the server and the browser. */
  now: string;
}

export function ActivityTimeline({ studentId, initial, now }: ActivityTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>(initial.items);
  const [nextBefore, setNextBefore] = useState<string | null>(initial.nextBefore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  async function loadOlder() {
    if (!nextBefore || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchTimeline(studentId, { before: nextBefore });
      setEvents((current) => {
        const known = new Set(current.map((event) => event.id));
        return [...current, ...page.items.filter((event) => !known.has(event.id))];
      });
      setNextBefore(page.nextBefore);
      setAnnouncement(
        `Loaded ${page.items.length} older ${page.items.length === 1 ? "event" : "events"}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : "Could not load older events. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  const days = groupByDay(events, now);

  return (
    <Card id="activity-timeline">
      <CardHeader>
        <CardTitle>Activity timeline</CardTitle>
        <CardDescription>
          Status changes, charges, payments, voids, submissions, mark changes and releases, newest
          first. Times are in Asia/Dhaka.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title="No activity yet"
            description="Changes to this student's record, fees and results will appear here."
          />
        ) : (
          <div className="space-y-6">
            {days.map((day) => (
              <section key={day.date} aria-labelledby={`timeline-day-${day.date}`}>
                <h3
                  id={`timeline-day-${day.date}`}
                  className="mb-3 flex items-baseline gap-2 text-sm font-medium"
                >
                  {day.heading}
                  {day.heading === formatDate(day.date) ? null : (
                    <span className="text-xs font-normal text-muted-foreground">
                      {formatDate(day.date)}
                    </span>
                  )}
                </h3>
                <ol className="space-y-4">
                  {day.events.map((event) => (
                    <TimelineItem key={event.id} event={event} now={now} />
                  ))}
                </ol>
              </section>
            ))}

            <div className="flex flex-col items-start gap-2">
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {nextBefore ? (
                <Button type="button" variant="outline" onClick={loadOlder} disabled={loading}>
                  {loading ? (
                    <Loader2Icon
                      className="animate-spin"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                  ) : null}
                  {error ? "Try again" : "Load older events"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">That is everything on record.</p>
              )}
            </div>
          </div>
        )}
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </CardContent>
    </Card>
  );
}
