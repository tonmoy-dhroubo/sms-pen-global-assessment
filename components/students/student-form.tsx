"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { DuplicateDialog } from "@/components/students/duplicate-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiRequestError } from "@/lib/client/api";
import { handleApiError } from "@/lib/client/api-errors";
import {
  createStudentRequest,
  duplicateMatchesFrom,
  updateStudentRequest,
  type DuplicateMatch,
  type StudentResponse,
} from "@/lib/client/students";
import type { ProgrammeOption } from "@/lib/services/students";
import { todayIn } from "@/lib/services/rules/time";
import {
  MAX_YEAR_OF_STUDY,
  studentFormSchema,
  type StudentFormValues,
  type UpdateStudentInput,
} from "@/lib/validation/students";

// The new-student and edit-student form (pages.md `/staff/students/new` and `.../[id]/edit`). One form, two modes:
//   - create: POST /api/students. A probable duplicate opens a dialog listing the matches, with "Create anyway".
//   - edit:   PATCH /api/students/{id} with the `version` that was loaded, sending only the fields that changed. A
//             stale version shows "This record changed since you opened it" with a reload.
// The Zod schema is the one the API validates with; the server's answers (field errors, a taken email) are mapped back
// onto the fields.

const FIELD_NAMES = [
  "fullName",
  "email",
  "dateOfBirth",
  "programmeId",
  "academicYear",
  "yearOfStudy",
] as const;

export type StudentFormMode =
  { kind: "create" } | { kind: "edit"; id: string; studentNumber: string; version: number };

export interface StudentFormProps {
  mode: StudentFormMode;
  programmes: ProgrammeOption[];
  /** Sessions to offer, newest first (the current value is added if it is missing). */
  academicYears: string[];
  /** Values to start from: the current session for a new student, the stored record when editing. */
  initialValues: Partial<StudentFormValues>;
}

interface EmailClash {
  id: string;
  studentNumber: string;
  fullName: string;
}

function emailClashFrom(details: Record<string, unknown> | undefined): EmailClash | null {
  const existing = details?.existing;
  if (!existing || typeof existing !== "object") return null;
  const { id, studentNumber, fullName } = existing as Record<string, unknown>;
  return typeof id === "string" && typeof studentNumber === "string" && typeof fullName === "string"
    ? { id, studentNumber, fullName }
    : null;
}

export function StudentForm({ mode, programmes, academicYears, initialValues }: StudentFormProps) {
  const router = useRouter();
  const editing = mode.kind === "edit";

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      dateOfBirth: "",
      programmeId: "",
      academicYear: academicYears[0] ?? "",
      yearOfStudy: 1,
      ...initialValues,
    },
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;

  // The warned-about submission is kept as it was sent, so "Create anyway" confirms exactly that.
  const [duplicates, setDuplicates] = useState<{
    matches: DuplicateMatch[];
    values: StudentFormValues;
  } | null>(null);
  const [emailClash, setEmailClash] = useState<EmailClash | null>(null);
  const [conflict, setConflict] = useState(false);

  const programmeId = useWatch({ control: form.control, name: "programmeId" });
  const selected = programmes.find((programme) => programme.id === programmeId);
  const maxYear = selected?.durationYears ?? Math.max(...programmes.map((p) => p.durationYears), 1);
  const years = Array.from({ length: Math.min(maxYear, MAX_YEAR_OF_STUDY) }, (_, i) => i + 1);
  const sessions = [...new Set([...academicYears, initialValues.academicYear ?? ""])]
    .filter(Boolean)
    .sort()
    .reverse();
  const today = todayIn(new Date());

  function finish(student: StudentResponse, message: string) {
    toast.success(message);
    for (const warning of student.warnings ?? [])
      toast.warning(warning.message, { duration: 10_000 });
    router.push(`/staff/students/${student.id}`);
    router.refresh();
  }

  async function create(values: StudentFormValues, confirmDuplicate: boolean) {
    const student = await createStudentRequest(
      confirmDuplicate ? { ...values, confirmDuplicate: true } : values,
    );
    finish(student, `Created ${student.fullName} (${student.studentNumber}).`);
  }

  function handleFailure(error: unknown, values: StudentFormValues) {
    if (error instanceof ApiRequestError) {
      if (error.code === "DUPLICATE_WARNING") {
        const matches = duplicateMatchesFrom(error.details);
        if (matches.length > 0) {
          setDuplicates({ matches, values });
          return;
        }
      }
      if (error.code === "CONFLICT" && error.details?.field === "email") {
        setEmailClash(emailClashFrom(error.details));
        form.setError("email", { type: "server", message: error.message }, { shouldFocus: true });
        return;
      }
      if (error.code === "VERSION_CONFLICT") {
        setConflict(true);
        return;
      }
    }
    handleApiError(error, { setError: form.setError, fields: FIELD_NAMES });
  }

  const submit = form.handleSubmit(async (values) => {
    setEmailClash(null);
    try {
      if (mode.kind === "create") {
        await create(values, false);
        return;
      }
      const changes: Partial<StudentFormValues> = {};
      for (const name of FIELD_NAMES) {
        if (dirtyFields[name]) Object.assign(changes, { [name]: values[name] });
      }
      if (Object.keys(changes).length === 0) {
        toast.info("Nothing to save: no fields were changed.");
        return;
      }
      const body: UpdateStudentInput = { ...changes, version: mode.version };
      const student = await updateStudentRequest(mode.id, body);
      finish(student, `Saved changes to ${student.fullName}.`);
    } catch (error) {
      handleFailure(error, values);
    }
  });

  async function createAnyway() {
    if (!duplicates) return;
    const { values } = duplicates;
    try {
      await create(values, true);
      setDuplicates(null);
    } catch (error) {
      setDuplicates(null);
      handleFailure(error, values);
    }
  }

  return (
    <>
      <form
        onSubmit={submit}
        noValidate
        className="grid max-w-2xl gap-6"
        aria-label={editing ? "Edit student" : "New student"}
      >
        {conflict ? (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>This record changed since you opened it</AlertTitle>
            <AlertDescription>
              <p>
                Someone else saved this student while you were editing. Reload to see the latest
                details; your unsaved changes here will be discarded.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => router.refresh()}
              >
                Reload latest
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup>
          {mode.kind === "create" ? (
            <p className="text-sm text-muted-foreground">
              The Student ID is assigned when you save.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Student ID <span className="font-mono text-foreground">{mode.studentNumber}</span>{" "}
              (cannot be changed).
            </p>
          )}

          <Controller
            name="fullName"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="student-full-name">Full name</FieldLabel>
                <Input
                  {...field}
                  id="student-full-name"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                  disabled={isSubmitting}
                />
                {fieldState.invalid ? <FieldError errors={[errors.fullName]} /> : null}
              </Field>
            )}
          />

          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="student-email">Email</FieldLabel>
                <Input
                  {...field}
                  id="student-email"
                  type="email"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setEmailClash(null);
                    field.onChange(event);
                  }}
                />
                {fieldState.invalid ? <FieldError errors={[errors.email]} /> : null}
                {emailClash ? (
                  <p className="text-sm">
                    <Link
                      href={`/staff/students/${emailClash.id}`}
                      className="underline underline-offset-4"
                    >
                      View {emailClash.fullName} ({emailClash.studentNumber})
                    </Link>
                  </p>
                ) : null}
              </Field>
            )}
          />

          <Controller
            name="dateOfBirth"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="student-dob">Date of birth</FieldLabel>
                <Input
                  {...field}
                  id="student-dob"
                  type="date"
                  max={today}
                  aria-invalid={fieldState.invalid}
                  aria-describedby="student-dob-hint"
                  disabled={isSubmitting}
                  className="sm:w-48"
                />
                <FieldDescription id="student-dob-hint">
                  Students must be 16 to 100 years old.
                </FieldDescription>
                {fieldState.invalid ? <FieldError errors={[errors.dateOfBirth]} /> : null}
              </Field>
            )}
          />

          <Controller
            name="programmeId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="student-programme">Programme</FieldLabel>
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    // A shorter programme cannot have a year beyond its length.
                    const next = programmes.find((programme) => programme.id === value);
                    const year = form.getValues("yearOfStudy");
                    if (next && year > next.durationYears) {
                      form.setValue("yearOfStudy", next.durationYears, { shouldDirty: true });
                    }
                  }}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="student-programme"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    aria-invalid={fieldState.invalid}
                    className="w-full"
                  >
                    <SelectValue placeholder="Choose a programme" />
                  </SelectTrigger>
                  <SelectContent>
                    {programmes.map((programme) => (
                      <SelectItem key={programme.id} value={programme.id}>
                        {programme.name} ({programme.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldState.invalid ? <FieldError errors={[errors.programmeId]} /> : null}
              </Field>
            )}
          />

          <div className="grid gap-6 sm:grid-cols-2">
            <Controller
              name="academicYear"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="student-session">Session</FieldLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger
                      id="student-session"
                      ref={field.ref}
                      onBlur={field.onBlur}
                      aria-invalid={fieldState.invalid}
                      className="w-full"
                    >
                      <SelectValue placeholder="Choose a session" />
                    </SelectTrigger>
                    <SelectContent>
                      {sessions.map((session) => (
                        <SelectItem key={session} value={session}>
                          {session}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldState.invalid ? <FieldError errors={[errors.academicYear]} /> : null}
                </Field>
              )}
            />

            <Controller
              name="yearOfStudy"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="student-year">Year of study</FieldLabel>
                  <Select
                    value={field.value ? String(field.value) : ""}
                    onValueChange={(value) => field.onChange(Number(value))}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger
                      id="student-year"
                      ref={field.ref}
                      onBlur={field.onBlur}
                      aria-invalid={fieldState.invalid}
                      className="w-full"
                    >
                      <SelectValue placeholder="Choose a year" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={year} value={String(year)}>
                          Year {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldState.invalid ? <FieldError errors={[errors.yearOfStudy]} /> : null}
                </Field>
              )}
            />
          </div>
        </FieldGroup>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            {editing ? "Save changes" : "Create student"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={() =>
              router.push(mode.kind === "edit" ? `/staff/students/${mode.id}` : "/staff/students")
            }
          >
            Cancel
          </Button>
        </div>
      </form>

      <DuplicateDialog
        open={duplicates !== null}
        matches={duplicates?.matches ?? []}
        onCancel={() => setDuplicates(null)}
        onCreateAnyway={createAnyway}
      />
    </>
  );
}
