"use client";

import { useRouter } from "next/navigation";
import { AssessmentForm, type ModuleOption } from "@/components/assessments/assessment-form";

// The client half of `/staff/assessments/new`: the form, and where to go once it is saved (the new assessment).

export function NewAssessmentForm({ modules, now }: { modules: ModuleOption[]; now: string }) {
  const router = useRouter();
  return (
    <AssessmentForm
      mode={{ kind: "create" }}
      modules={modules}
      now={now}
      onSaved={(assessment) => {
        router.push(`/staff/assessments/${assessment.id}`);
        router.refresh();
      }}
      onCancel={() => router.push("/staff/assessments")}
    />
  );
}
