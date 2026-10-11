import { formatDateTime } from "@/lib/services/rules/time";
import { print } from "./context";
import type { SeedResult } from "./run";

/** Prints what was seeded and what the self-check verified. */
export function printSeedReport(result: SeedResult): void {
  const { summary: s } = result;
  print();
  print(`Seeded relative to ${formatDateTime(result.seedMoment)} (Asia/Dhaka):`);
  print(
    `  ${s.staff} staff, ${s.programmes} programmes, ${s.modules} modules, ${s.assessments} assessments, ${s.students} students`,
  );
  print(
    `  ${s.charges} fee charges, ${s.payments} payments, ${s.submissions} submissions (${s.files} files), ${s.marks} marks, ${s.markChanges} mark changes`,
  );
  print();
  print("Self-check passed:");
  for (const line of result.lines) print(`  ok  ${line}`);
  print();
  print(`Seed fingerprint: ${result.fingerprint}`);
}
