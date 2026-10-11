import { apiRequest } from "@/lib/client/api";
import type { DuplicateMatch, StudentRecord } from "@/lib/services/students";
import type {
  ChangeStatusInput,
  CreateStudentInput,
  UpdateStudentInput,
} from "@/lib/validation/students";

// Browser calls behind the student forms and the status dialog (api.md "Students"). Type-only imports above:
// nothing server-side is bundled.

export type { DuplicateMatch, StudentRecord };

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
