"use client";

import { useEffect, useState } from "react";
import { fetchSessionOptions, type SessionOptions } from "@/lib/client/session";
import { ApiRequestError } from "@/lib/client/api";
import { useDebounced } from "@/lib/client/use-debounced";

// The staff list and the searchable student list behind the role picker and the header switcher
// (`GET /api/session/options`). The search text is debounced so typing does not fire a request per keystroke, and an
// outdated request is cancelled when a newer one starts.

export const SEARCH_DEBOUNCE_MS = 250;

export type OptionsStatus = "loading" | "error" | "ready";

export interface UseSessionOptionsResult {
  query: string;
  setQuery: (value: string) => void;
  options: SessionOptions | null;
  /** `loading` also covers the moment between a keystroke and the debounced request. */
  status: OptionsStatus;
  error: string | null;
  retry: () => void;
}

interface Settled {
  /** `<search text>#<attempt>` the data belongs to. */
  key: string;
  options: SessionOptions | null;
  error: string | null;
}

/**
 * @param enabled  Fetch only while true (the switcher's popover is open).
 * @param initial  Options already loaded on the server for an empty search; avoids a loading flash on first paint.
 */
export function useSessionOptions({
  enabled = true,
  initial,
}: { enabled?: boolean; initial?: SessionOptions } = {}): UseSessionOptionsResult {
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const debounced = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const key = `${debounced}#${attempt}`;
  const [settled, setSettled] = useState<Settled | null>(
    initial ? { key: "#0", options: initial, error: null } : null,
  );

  useEffect(() => {
    if (!enabled || settled?.key === key) return;
    const controller = new AbortController();
    fetchSessionOptions(debounced, controller.signal)
      .then((options) => setSettled({ key, options, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof ApiRequestError ? error.message : "Could not load the list. Try again.";
        setSettled({ key, options: null, error: message });
      });
    return () => controller.abort();
    // `settled` is read only to skip a fetch whose result is already here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, debounced]);

  const waiting = query.trim() !== debounced || settled?.key !== key;
  const status: OptionsStatus = waiting ? "loading" : settled?.error ? "error" : "ready";

  return {
    query,
    setQuery,
    // Keep showing the previous results while the next ones load, so the list does not flicker empty.
    options: settled?.options ?? null,
    status: !enabled && !settled ? "loading" : status,
    error: settled?.error ?? null,
    retry: () => setAttempt((value) => value + 1),
  };
}
