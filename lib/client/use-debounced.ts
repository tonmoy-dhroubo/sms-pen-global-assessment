"use client";

import { useEffect, useState } from "react";

/** `value`, but only after it has stayed the same for `delayMs`; typing fires one lookup instead of one per key. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
