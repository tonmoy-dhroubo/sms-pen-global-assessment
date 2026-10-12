"use client";

import { CheckIcon, ChevronsUpDownIcon, Loader2Icon, LogOutIcon } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CurrentIdentity } from "@/components/session/current-identity";
import { useSessionOptions } from "@/components/session/use-session-options";
import { CHANGE_ROLE_PENDING, useSwitchIdentity } from "@/components/session/use-switch-identity";
import type { SwitchSessionInput } from "@/lib/client/session";

// The header's "Viewing as: ..." control (pages.md "Role switcher", D-020). A popover holding every staff member and
// a searchable student list (name or Student ID), fed by `GET /api/session/options`. Choosing someone calls
// `PUT /api/session` and lands on that role's home. The search is done by the server (it matches regardless of case
// and accents), so the command list does no filtering of its own for students; the field is a plain combobox that
// arrow keys, Enter and Escape drive. "Change role" at the bottom clears the session and returns to the role picker.

const CHANGE_ROLE_VALUE = "change-role";

export function RoleSwitcher({ current }: { current: CurrentIdentity | null }) {
  const [open, setOpen] = useState(false);
  const { query, setQuery, options, status, error, retry } = useSessionOptions({ enabled: open });
  const { switchTo, changeRole, pendingId } = useSwitchIdentity();

  const needle = query.trim().toLowerCase();
  const staff = (options?.staff ?? []).filter(
    (member) =>
      !needle ||
      member.fullName.toLowerCase().includes(needle) ||
      member.jobTitle.toLowerCase().includes(needle),
  );
  const students = options?.students.items ?? [];
  const total = options?.students.total ?? 0;
  const busy = pendingId !== null;

  // The list is filtered by the server, so cmdk does not pick a first item for us. Keep one highlighted so Enter works
  // straight after typing, and move the highlight when the results change underneath it.
  const values = [
    ...staff.map((member) => `staff-${member.id}`),
    ...students.map((student) => `student-${student.id}`),
    ...(current ? [CHANGE_ROLE_VALUE] : []),
  ];
  const [picked, setPicked] = useState("");
  const highlighted = values.includes(picked) ? picked : (values[0] ?? "");

  async function choose(target: SwitchSessionInput) {
    const id = target.role === "staff" ? target.staffId : target.studentId;
    if (current?.id === id) {
      setOpen(false);
      return;
    }
    if (await switchTo(target)) setOpen(false);
  }

  async function leave() {
    if (await changeRole()) setOpen(false);
  }

  const label = current ? current.fullName : "Not selected";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-haspopup="listbox" className="max-w-[14rem] gap-1.5">
          <span className="sr-only sm:not-sr-only sm:text-muted-foreground">Viewing as:</span>
          <span className="truncate font-medium max-sm:max-w-24">{label}</span>
          <ChevronsUpDownIcon className="size-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command
          shouldFilter={false}
          value={highlighted}
          onValueChange={setPicked}
          label="Choose who to view the app as"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search students by name or ID"
            aria-label="Search students by name or Student ID"
          />
          <CommandList aria-busy={status === "loading"}>
            {staff.length > 0 ? (
              <CommandGroup heading="Registry staff">
                {staff.map((member) => (
                  <CommandItem
                    key={member.id}
                    value={`staff-${member.id}`}
                    disabled={busy}
                    onSelect={() => choose({ role: "staff", staffId: member.id })}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{member.fullName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member.jobTitle}
                      </div>
                    </div>
                    {pendingId === member.id ? (
                      <Loader2Icon className="animate-spin" aria-hidden="true" />
                    ) : current?.id === member.id ? (
                      <CheckIcon role="img" aria-label="Current" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            <CommandGroup heading="Students">
              {students.map((student) => (
                <CommandItem
                  key={student.id}
                  value={`student-${student.id}`}
                  disabled={busy}
                  onSelect={() => choose({ role: "student", studentId: student.id })}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{student.fullName}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {student.studentNumber}
                    </div>
                  </div>
                  <StatusBadge group="enrolment" value={student.status} />
                  {pendingId === student.id ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : current?.id === student.id ? (
                    <CheckIcon role="img" aria-label="Current" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>

            <div role="status" className="px-3 py-3 text-center text-sm text-muted-foreground">
              {status === "loading" ? (
                "Searching…"
              ) : status === "error" ? (
                <>
                  {error}{" "}
                  <Button variant="link" size="sm" onClick={retry} className="h-auto p-0">
                    Try again
                  </Button>
                </>
              ) : students.length === 0 ? (
                "No students match your search."
              ) : total > students.length ? (
                `Showing ${students.length} of ${total} students. Type to narrow the list.`
              ) : null}
            </div>

            {current ? (
              <>
                <CommandSeparator alwaysRender />
                <CommandGroup>
                  <CommandItem value={CHANGE_ROLE_VALUE} disabled={busy} onSelect={leave}>
                    <LogOutIcon aria-hidden="true" />
                    <span className="flex-1">Change role</span>
                    {pendingId === CHANGE_ROLE_PENDING ? (
                      <Loader2Icon className="animate-spin" aria-hidden="true" />
                    ) : null}
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
