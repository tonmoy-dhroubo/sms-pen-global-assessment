"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/services/rules/time";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "2d 4h 12m 33s" for a deadline still ahead (leading zero units dropped, seconds always shown), or
 * "Deadline passed 3 hours ago" once it is behind us.
 */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) {
    return remainingMs > -MINUTE
      ? "Deadline just passed"
      : `Deadline passed ${formatDuration(remainingMs)} ago`;
  }
  const days = Math.floor(remainingMs / DAY);
  const hours = Math.floor((remainingMs % DAY) / HOUR);
  const minutes = Math.floor((remainingMs % HOUR) / MINUTE);
  const seconds = Math.floor((remainingMs % MINUTE) / SECOND);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export interface CountdownProps {
  /** The deadline, as an ISO timestamp. */
  deadline: string;
  /**
   * The server's "now" (ISO). The first render, on the server and in the browser, is computed from this exact
   * moment so the markup matches and hydration does not mismatch; afterwards the browser's own elapsed time is
   * added on top so it ticks without trusting the visitor's clock.
   */
  serverNow: string;
  className?: string;
}

export function Countdown({ deadline, serverNow, className }: CountdownProps) {
  const deadlineMs = new Date(deadline).getTime();
  const startMs = new Date(serverNow).getTime();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const mountedAt = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - mountedAt), SECOND);
    return () => window.clearInterval(id);
  }, []);

  if (Number.isNaN(deadlineMs) || Number.isNaN(startMs))
    return <span className={className}>&mdash;</span>;

  const remaining = deadlineMs - (startMs + elapsed);
  return (
    // role="timer" is not announced on every tick (implicit aria-live="off").
    <span role="timer" className={cn("tabular-nums", className)} data-past={remaining <= 0}>
      {formatCountdown(remaining)}
    </span>
  );
}
