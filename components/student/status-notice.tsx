import { InfoIcon } from "lucide-react";
import type { EnrolmentStatus } from "@/lib/services/rules/types";
import { cn } from "@/lib/utils";

// The notice a student sees on their overview when they are not Enrolled (pages.md `/student`): what has changed, what
// they can still do and what they cannot. It states the rules the server enforces: uploads need an Enrolled student
// (`NOT_ENROLLED`), while fees, published results and downloads of their own files stay available whatever the status.

interface NoticeText {
  title: string;
  body: string;
  /** What to do next: always the Registry office. */
  action: string;
  tone: string;
}

const NOTICES: Record<Exclude<EnrolmentStatus, "ENROLLED">, NoticeText> = {
  DEFERRED: {
    title: "Your studies are deferred",
    body: "You can still see your fees, deadlines and published results, and download files you have already submitted. You can't upload new work while you are deferred.",
    action: "To return to your studies, contact the Registry office.",
    tone: "bg-tone-amber text-tone-amber-foreground",
  },
  WITHDRAWN: {
    title: "You have withdrawn from your programme",
    body: "You can still see your fees and published results, and download files you have already submitted. You can't upload new work.",
    action: "If you want to be re-admitted, contact the Registry office.",
    tone: "bg-tone-grey text-tone-grey-foreground",
  },
  COMPLETED: {
    title: "You have completed your programme",
    body: "Your fees, published results and past submissions stay available here. You can't upload new work.",
    action: "If something looks wrong, contact the Registry office.",
    tone: "bg-tone-blue text-tone-blue-foreground",
  },
};

export function StatusNotice({
  status,
  className,
}: {
  status: EnrolmentStatus;
  className?: string;
}) {
  if (status === "ENROLLED") return null;
  const { title, body, action, tone } = NOTICES[status];
  return (
    <div
      role="status"
      data-slot="status-notice"
      data-status={status}
      className={cn("flex gap-3 rounded-xl px-4 py-3 text-sm", tone, className)}
    >
      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{title}</p>
        <p>{body}</p>
        <p>{action}</p>
      </div>
    </div>
  );
}
