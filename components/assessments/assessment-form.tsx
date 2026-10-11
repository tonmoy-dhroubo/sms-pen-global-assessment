"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { DeadlineInput } from "@/components/assessments/deadline-input";
import { Notice } from "@/components/shared/notice";
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
  createAssessmentRequest,
  updateAssessmentRequest,
  type AssessmentResponse,
  type UpdateAssessmentBody,
} from "@/lib/client/assessments";
import { todayIn } from "@/lib/services/rules/time";
import {
  TITLE_MAX_LENGTH,
  assessmentFormSchema,
  toDeadlineInstant,
  type AssessmentFormValues,
} from "@/lib/validation/assessments";

// The new-assessment form and the edit-assessment form (pages.md `/staff/assessments/new`, and Edit on the detail
// page). One form, two modes:
//   - create: POST /api/assessments. A deadline already in the past is allowed (the form says so; the API warns).
//   - edit:   PATCH /api/assessments/{id} with the `version` that was loaded, sending only what changed. The module
//             is locked once students have submitted. Moving the deadline warns that late flags are recalculated, and
//             the server's count of flags that changed is shown after saving. A stale version shows "This record
//             changed since you opened it" with a reload.
// The deadline is typed in Asia/Dhaka and sent as a UTC instant. The Zod schema is the one the API validates with;
// the server's answers are mapped back onto the fields.

const FIELD_NAMES = ["moduleId", "title", "deadlineDate", "deadlineTime"] as const;

export interface ModuleOption {
  id: string;
  code: string;
  title: string;
}

export type AssessmentFormMode =
  | { kind: "create" }
  | {
      kind: "edit";
      id: string;
      /** The version that was loaded; a stale one is refused by the server. */
      version: number;
      /** Students who have submitted: the module is locked and a deadline change recalculates their flags. */
      submitted: number;
    };

export interface AssessmentFormProps {
  mode: AssessmentFormMode;
  modules: ModuleOption[];
  /** Values to start from: empty for a new assessment, the stored record when editing. */
  initialValues?: Partial<AssessmentFormValues>;
  /** The server's "now" (ISO): sets the default deadline and the "in the past" notice. */
  now: string;
  /** Called with the saved assessment (after the success and warning toasts). */
  onSaved: (assessment: AssessmentResponse) => void;
  onCancel: () => void;
  /** "Reload latest" after a version conflict. */
  onReload?: () => void;
}

/** The day after a `YYYY-MM-DD` date. */
function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function AssessmentForm({
  mode,
  modules,
  initialValues,
  now,
  onSaved,
  onCancel,
  onReload,
}: AssessmentFormProps) {
  const editing = mode.kind === "edit";
  const form = useForm<AssessmentFormValues>({
    resolver: zodResolver(assessmentFormSchema),
    defaultValues: {
      moduleId: "",
      title: "",
      // A sensible start: the end of tomorrow, Dhaka time.
      deadlineDate: nextDay(todayIn(new Date(now))),
      deadlineTime: "23:59",
      ...initialValues,
    },
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;
  const [conflict, setConflict] = useState(false);

  const deadlineChanged = Boolean(dirtyFields.deadlineDate || dirtyFields.deadlineTime);
  const moduleLocked = editing && mode.submitted > 0;

  function warnAbout(assessment: AssessmentResponse) {
    for (const warning of assessment.warnings ?? []) {
      toast.warning(warning.message, { duration: 15_000 });
    }
  }

  const submit = form.handleSubmit(async (values) => {
    try {
      let saved: AssessmentResponse;
      if (mode.kind === "create") {
        saved = await createAssessmentRequest({
          moduleId: values.moduleId,
          title: values.title,
          deadline: toDeadlineInstant(values.deadlineDate, values.deadlineTime),
        });
        toast.success(`Created ${saved.title}.`);
      } else {
        const body: Partial<UpdateAssessmentBody> = {};
        if (dirtyFields.moduleId) body.moduleId = values.moduleId;
        if (dirtyFields.title) body.title = values.title;
        if (deadlineChanged) {
          body.deadline = toDeadlineInstant(values.deadlineDate, values.deadlineTime);
        }
        if (Object.keys(body).length === 0) {
          toast.info("Nothing to save: no fields were changed.");
          return;
        }
        saved = await updateAssessmentRequest(mode.id, { ...body, version: mode.version });
        toast.success(`Saved changes to ${saved.title}.`);
      }
      warnAbout(saved);
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.code === "VERSION_CONFLICT") {
          setConflict(true);
          return;
        }
        if (
          error.code === "BUSINESS_RULE" &&
          error.details?.rule === "ASSESSMENT_HAS_SUBMISSIONS"
        ) {
          form.setError(
            "moduleId",
            { type: "server", message: error.message },
            { shouldFocus: true },
          );
          return;
        }
      }
      handleApiError<AssessmentFormValues>(error, {
        setError: (name, problem, options) =>
          form.setError(
            // The API names the instant `deadline`; on the form it is the date field that carries the message.
            (name as string) === "deadline" ? "deadlineDate" : name,
            problem,
            options,
          ),
        fields: [...FIELD_NAMES, "deadline"],
      });
    }
  });

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-6"
      aria-label={editing ? "Edit assessment" : "New assessment"}
    >
      {conflict ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>This record changed since you opened it</AlertTitle>
          <AlertDescription>
            <p>
              Someone else saved this assessment while you were editing. Reload to see the latest
              details; your unsaved changes here will be discarded.
            </p>
            {onReload ? (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onReload}>
                Reload latest
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Controller
          name="moduleId"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="assessment-module">Module</FieldLabel>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isSubmitting || moduleLocked}
              >
                <SelectTrigger
                  id="assessment-module"
                  ref={field.ref}
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={moduleLocked ? "assessment-module-hint" : undefined}
                  className="w-full"
                >
                  <SelectValue placeholder="Choose a module" />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((module) => (
                    <SelectItem key={module.id} value={module.id}>
                      {module.code} &middot; {module.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {moduleLocked ? (
                <FieldDescription id="assessment-module-hint">
                  The module cannot be changed because {mode.submitted}{" "}
                  {mode.submitted === 1 ? "student has" : "students have"} already submitted.
                </FieldDescription>
              ) : null}
              {fieldState.invalid ? <FieldError errors={[errors.moduleId]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="title"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="assessment-title">Title</FieldLabel>
              <Input
                {...field}
                id="assessment-title"
                autoComplete="off"
                maxLength={TITLE_MAX_LENGTH + 20}
                aria-invalid={fieldState.invalid}
                disabled={isSubmitting}
              />
              {fieldState.invalid ? <FieldError errors={[errors.title]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="deadlineDate"
          control={form.control}
          render={({ field: dateField }) => (
            <Controller
              name="deadlineTime"
              control={form.control}
              render={({ field: timeField }) => (
                <DeadlineInput
                  idPrefix="assessment-deadline"
                  date={dateField.value}
                  time={timeField.value}
                  onDateChange={dateField.onChange}
                  onTimeChange={timeField.onChange}
                  dateError={errors.deadlineDate?.message}
                  timeError={errors.deadlineTime?.message}
                  disabled={isSubmitting}
                  now={now}
                />
              )}
            />
          )}
        />

        {editing && deadlineChanged && mode.submitted > 0 ? (
          <Notice>
            Changing the deadline recalculates which of the {mode.submitted}{" "}
            {mode.submitted === 1 ? "submission is" : "submissions are"} late. Late status is worked
            out from the deadline, so nothing is lost and you can change it back.
          </Notice>
        ) : null}
      </FieldGroup>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {editing ? "Save changes" : "Create assessment"}
        </Button>
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
