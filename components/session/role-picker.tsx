"use client";

import { Loader2Icon, SearchIcon, UserRoundIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useSessionOptions } from "@/components/session/use-session-options";
import { useSwitchIdentity } from "@/components/session/use-switch-identity";
import type { SessionOptions } from "@/lib/client/session";

// The public role picker at `/` (pages.md): choose a staff member, or search for a student. Both end in
// `PUT /api/session` and a landing on that role's home. The server passes the first page of options so the cards
// are there on first paint; typing in the search box asks `/api/session/options` for matches.

export function RolePicker({ initial }: { initial: SessionOptions }) {
  const { query, setQuery, options, status, error, retry } = useSessionOptions({ initial });
  const { switchTo, pendingId } = useSwitchIdentity();
  const busy = pendingId !== null;
  const staff = options?.staff ?? initial.staff;
  const students = options?.students.items ?? [];
  const total = options?.students.total ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="picker-staff" className="space-y-3">
        <div>
          <h2 id="picker-staff" className="text-lg font-semibold">
            Registry staff
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage enrolment, fees, assessments and results.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {staff.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => switchTo({ role: "staff", staffId: member.id })}
                className="flex w-full items-center gap-3 rounded-xl bg-card p-4 text-left shadow-xs ring-1 ring-foreground/10 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {pendingId === member.id ? (
                    <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <UserRoundIcon className="size-5" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{member.fullName}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {member.jobTitle}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="picker-student">
        <Card>
          <CardHeader>
            <CardTitle id="picker-student" className="text-lg">
              Student
            </CardTitle>
            <CardDescription>
              See the app as a student sees it: their own fees, assessments and published results.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field>
              <FieldLabel htmlFor="picker-student-search">Search by name or Student ID</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="picker-student-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="e.g. Rahman, or SMS-2026-0012"
                  autoComplete="off"
                />
                <InputGroupAddon>
                  <SearchIcon aria-hidden="true" />
                </InputGroupAddon>
              </InputGroup>
            </Field>

            <ul
              aria-label="Matching students"
              aria-busy={status === "loading"}
              className="max-h-80 divide-y overflow-y-auto border-y"
            >
              {students.map((student) => (
                <li key={student.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => switchTo({ role: "student", studentId: student.id })}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{student.fullName}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {student.studentNumber}
                      </span>
                    </span>
                    <StatusBadge group="enrolment" value={student.status} />
                    {pendingId === student.id ? (
                      <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>

            <p role="status" className="text-sm text-muted-foreground">
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
              ) : (
                `${total} ${total === 1 ? "student" : "students"}`
              )}
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
