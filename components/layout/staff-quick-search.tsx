"use client";

import { Command as CommandPrimitive } from "cmdk";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ApiRequestError } from "@/lib/client/api";
import { searchStudents, type StudentList } from "@/lib/client/students";
import { useDebounced } from "@/lib/client/use-debounced";

// The header's staff quick search (pages.md "Global layout", milestone M16): type a name, part of a Student ID or an
// email address, see up to eight matches in a popover, press Enter (or click) to open the record. Ctrl+K (Cmd+K on a
// Mac) focuses it from anywhere on a staff page. It asks `GET /api/students?q=&pageSize=8` for all four statuses, so
// withdrawn and completed students (hidden from the Students list by default) are found too.
//
// Accessibility: the input is cmdk's combobox (`role="combobox"`, `aria-controls` the results listbox,
// `aria-activedescendant` the highlighted option); focus never leaves the input, arrow keys move the highlight and
// Escape closes the list. cmdk always reports `aria-expanded="true"`; the effect below keeps it truthful.

export const QUICK_SEARCH_PAGE_SIZE = 8;
export const QUICK_SEARCH_DEBOUNCE_MS = 250;

const VIEW_ALL = "view-all";

type Settled =
  | { query: string; list: StudentList; error?: undefined }
  | { query: string; list?: undefined; error: string };

const subscribeToNothing = () => () => {};
const onMac = () => /mac|iphone|ipad/i.test(navigator.platform);

/** `⌘K` on Apple devices, `Ctrl K` elsewhere (and in the server render, so the first paint matches). */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    subscribeToNothing,
    () => (onMac() ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

export function StaffQuickSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [picked, setPicked] = useState("");
  const shortcut = useShortcutLabel();
  // The text Enter was pressed for while its results were still on their way: open the first match when they arrive.
  const enterFor = useRef<string | null>(null);
  const openRef = useRef<(id: string) => void>(() => {});

  const text = query.trim();
  const debounced = useDebounced(text, QUICK_SEARCH_DEBOUNCE_MS);

  // The lookup, cancelled when a newer one starts or the box is cleared.
  useEffect(() => {
    if (!debounced) return;
    const controller = new AbortController();
    searchStudents(debounced, QUICK_SEARCH_PAGE_SIZE, controller.signal)
      .then((list) => {
        setSettled({ query: debounced, list });
        if (enterFor.current === debounced) {
          enterFor.current = null;
          const first = list.items[0];
          if (first) openRef.current(first.id);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({
          query: debounced,
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Could not search right now. Try again.",
        });
      });
    return () => controller.abort();
  }, [debounced]);

  // Ctrl+K / Cmd+K from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const showingResultsFor = settled && text !== "" && settled.query === text ? settled : null;
  // Until the lookup for what is typed now has come back, whatever was shown before stays (no flicker to empty).
  const visible = text === "" ? null : (showingResultsFor ?? settled);
  const waiting = text !== "" && showingResultsFor === null;
  const students = visible?.list?.items ?? [];
  const total = visible?.list?.total ?? 0;
  const error = visible?.error ?? null;

  const values = [
    ...students.map((student) => student.id),
    ...(total > students.length ? [VIEW_ALL] : []),
  ];
  const highlighted = values.includes(picked) ? picked : (values[0] ?? "");

  // cmdk hard-codes aria-expanded="true" on the input; say whether the list is really showing.
  useEffect(() => {
    inputRef.current?.setAttribute("aria-expanded", String(open));
  }, [open, query, settled]);

  const finish = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSettled(null);
    setPicked("");
    inputRef.current?.blur();
  }, []);

  const openStudent = useCallback(
    (id: string) => {
      finish();
      router.push(`/staff/students/${id}`);
    },
    [finish, router],
  );

  function viewAll() {
    const params = new URLSearchParams({ q: text });
    for (const status of ["ENROLLED", "DEFERRED", "WITHDRAWN", "COMPLETED"]) {
      params.append("status", status);
    }
    finish();
    router.push(`/staff/students?${params.toString()}`);
  }

  useEffect(() => {
    openRef.current = openStudent;
  });

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (text === "") {
      event.preventDefault();
      return;
    }
    if (waiting) {
      // The highlighted row belongs to older text; do not open it. Remember the intent instead.
      event.preventDefault();
      enterFor.current = text;
    }
  }

  return (
    <Command
      shouldFilter={false}
      value={highlighted}
      onValueChange={setPicked}
      onKeyDown={onKeyDown}
      label="Search students by name, Student ID or email"
      className="overflow-visible rounded-none! bg-transparent p-0"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} role="search">
            <InputGroup>
              <CommandPrimitive.Input
                ref={inputRef}
                data-slot="input-group-control"
                value={query}
                onValueChange={(value) => {
                  setQuery(value);
                  enterFor.current = null;
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onClick={() => setOpen(true)}
                placeholder="Search students"
                className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm outline-hidden placeholder:text-muted-foreground"
              />
              <InputGroupAddon>
                {waiting ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : (
                  <SearchIcon aria-hidden="true" />
                )}
              </InputGroupAddon>
              <InputGroupAddon align="inline-end" className="max-md:hidden">
                <kbd
                  aria-hidden="true"
                  className="pointer-events-none rounded border bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground"
                >
                  {shortcut}
                </kbd>
              </InputGroupAddon>
            </InputGroup>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          // Focus stays in the input; the list is only a view of what the input is searching for.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
          className="w-(--radix-popover-trigger-width) min-w-72 gap-0 p-0"
        >
          <CommandList aria-busy={waiting} className="max-h-80">
            {students.length > 0 ? (
              <CommandGroup heading="Students">
                {students.map((student) => (
                  <CommandItem
                    key={student.id}
                    value={student.id}
                    onSelect={() => openStudent(student.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{student.fullName}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {student.studentNumber}
                      </div>
                    </div>
                    <StatusBadge group="enrolment" value={student.status} />
                  </CommandItem>
                ))}
                {total > students.length ? (
                  <CommandItem value={VIEW_ALL} onSelect={viewAll}>
                    <span className="text-muted-foreground">
                      Showing {students.length} of {total}. View all matches in Students
                    </span>
                  </CommandItem>
                ) : null}
              </CommandGroup>
            ) : null}
            <div role="status" className="px-3 py-3 text-center text-sm text-muted-foreground">
              {text === ""
                ? "Type a name, a Student ID or an email address."
                : error
                  ? error
                  : waiting && students.length === 0
                    ? "Searching…"
                    : students.length === 0
                      ? `No students match “${text}”.`
                      : null}
            </div>
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}
