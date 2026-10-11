import { apiRequest } from "@/lib/client/api";
import type { AssessmentDetail } from "@/lib/services/assessments";
import type { DownloadLink } from "@/lib/services/files";
import type { CreateAssessmentInput, UpdateAssessmentInput } from "@/lib/validation/assessments";

// Browser calls behind the assessment forms, the close/reopen confirmations and the download buttons (api.md
// "Assessments", "Submissions and files"). Type-only imports above: nothing server-side is bundled.

export type { AssessmentDetail, DownloadLink };

export interface ResponseWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** An assessment plus the `warnings` a successful write may carry (api.md "Warnings"). */
export type AssessmentResponse = AssessmentDetail & { warnings?: ResponseWarning[] };

/** The create body as the browser sends it: the deadline is an ISO string, not yet a `Date`. */
export type CreateAssessmentBody = Omit<CreateAssessmentInput, "deadline"> & { deadline: string };
export type UpdateAssessmentBody = Omit<UpdateAssessmentInput, "deadline"> & { deadline?: string };

export function createAssessmentRequest(body: CreateAssessmentBody): Promise<AssessmentResponse> {
  return apiRequest<AssessmentResponse>("/api/assessments", { method: "POST", body });
}

export function updateAssessmentRequest(
  id: string,
  body: UpdateAssessmentBody,
): Promise<AssessmentResponse> {
  return apiRequest<AssessmentResponse>(`/api/assessments/${id}`, { method: "PATCH", body });
}

export function closeAssessmentRequest(id: string): Promise<AssessmentResponse> {
  return apiRequest<AssessmentResponse>(`/api/assessments/${id}/close`, { method: "POST" });
}

export function reopenAssessmentRequest(id: string): Promise<AssessmentResponse> {
  return apiRequest<AssessmentResponse>(`/api/assessments/${id}/reopen`, { method: "POST" });
}

export function downloadLinkRequest(fileId: string): Promise<DownloadLink> {
  return apiRequest<DownloadLink>(`/api/files/${fileId}/download`);
}
