import { apiRequest } from "@/lib/client/api";
import type {
  MarkDto,
  Marksheet,
  PublishResult,
  ReleaseChangeResult,
  StudentResults,
} from "@/lib/services/marks";

// Browser calls behind the marksheet grid, the publish preview dialog and the student record's Results section
// (api.md "Marks and results"). Type-only imports above: nothing server-side is bundled.

export type { MarkDto, Marksheet, PublishResult, ReleaseChangeResult, StudentResults };

export interface ResponseWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** A publish answer plus the `warnings` the server attached (the same ones for a dry run and a real run). */
export type PublishResponse = PublishResult & { warnings?: ResponseWarning[] };

/** What to publish: everything on an assessment, everything for a student, or the marks picked. */
export type PublishTarget =
  { assessmentId: string } | { studentId: string } | { markIds: string[] };

export interface PutMarkBody {
  mark?: string;
  isNonSubmission?: boolean;
  /** The version that was read; required once a mark exists. */
  version?: number;
  /** Required when the mark is already published. */
  reason?: string;
}

export function fetchMarksheet(assessmentId: string, signal?: AbortSignal): Promise<Marksheet> {
  return apiRequest<Marksheet>(`/api/assessments/${assessmentId}/marks`, { signal });
}

export function putMarkRequest(
  assessmentId: string,
  studentId: string,
  body: PutMarkBody,
): Promise<MarkDto> {
  return apiRequest<MarkDto>(`/api/assessments/${assessmentId}/marks/${studentId}`, {
    method: "PUT",
    body,
  });
}

export function publishMarksRequest(
  target: PublishTarget,
  options: { dryRun: boolean },
  signal?: AbortSignal,
): Promise<PublishResponse> {
  return apiRequest<PublishResponse>("/api/marks/publish", {
    method: "POST",
    body: { ...target, dryRun: options.dryRun },
    signal,
  });
}

export function withholdMarksRequest(
  markIds: string[],
  reason: string,
): Promise<ReleaseChangeResult> {
  return apiRequest<ReleaseChangeResult>("/api/marks/withhold", {
    method: "POST",
    body: { markIds, reason },
  });
}

export function unpublishMarksRequest(
  markIds: string[],
  reason: string,
): Promise<ReleaseChangeResult> {
  return apiRequest<ReleaseChangeResult>("/api/marks/unpublish", {
    method: "POST",
    body: { markIds, reason },
  });
}
