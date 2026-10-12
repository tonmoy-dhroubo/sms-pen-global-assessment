import { apiRequest } from "@/lib/client/api";
import type { DuplicateMatch, StudentList, StudentRecord } from "@/lib/services/students";
import type { StudentTimeline } from "@/lib/services/timeline";
import type {
  ChangeStatusInput,
  CreateStudentInput,
  UpdateStudentInput,
} from "@/lib/validation/students";

// Browser calls behind the student forms and the status dialog (api.md "Students"). Type-only imports above:
// nothing server-side is bundled.

export type { DuplicateMatch, StudentList, StudentRecord, StudentTimeline };

/** A student record plus the `warnings` a successful write may carry (api.md "Warnings"). */
export type StudentResponse = StudentRecord & {
  warnings?: { code: string; message: string }[];
};

export function createStudentRequest(body: CreateStudentInput): Promise<StudentResponse> {
  return apiRequest<StudentResponse>("/api/students", { method: "POST", body });
}

export function updateStudentRequest(
  id: string,
  body: UpdateStudentInput,
): Promise<StudentResponse> {
  return apiRequest<StudentResponse>(`/api/students/${id}`, { method: "PATCH", body });
}

export function changeStatusRequest(id: string, body: ChangeStatusInput): Promise<StudentResponse> {
  return apiRequest<StudentResponse>(`/api/students/${id}/status`, { method: "POST", body });
}

/** `details.matches` of a `DUPLICATE_WARNING`, defensively read. */
export function duplicateMatchesFrom(
  details: Record<string, unknown> | undefined,
): DuplicateMatch[] {
  const matches = details?.matches;
  return Array.isArray(matches) ? (matches as DuplicateMatch[]) : [];
}

/** `GET /api/students/{id}/timeline`: one page of activity, newest first; `before` is the previous page's `nextBefore`. */
export function fetchTimeline(
  studentId: string,
  options: { before?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<StudentTimeline> {
  const params = new URLSearchParams();
  if (options.before) params.set("before", options.before);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString();
  return apiRequest<StudentTimeline>(
    `/api/students/${studentId}/timeline${query ? `?${query}` : ""}`,
    { signal },
  );
}

/** Statuses the header quick search looks across: every one, so a withdrawn or completed student can be found. */
const ALL_STATUSES = ["ENROLLED", "DEFERRED", "WITHDRAWN", "COMPLETED"] as const;

/**
 * `GET /api/students?q=&pageSize=`: the header quick search (all four statuses, because the list's
 * default hides withdrawn and completed students and a Registry officer often needs exactly those).
 */
export function searchStudents(
  q: string,
  pageSize: number,
  signal?: AbortSignal,
): Promise<StudentList> {
  const params = new URLSearchParams({ q, pageSize: String(pageSize) });
  for (const status of ALL_STATUSES) params.append("status", status);
  return apiRequest<StudentList>(`/api/students?${params.toString()}`, { signal });
}
