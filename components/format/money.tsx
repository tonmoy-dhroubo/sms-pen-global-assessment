import { cn } from "@/lib/utils";
import { formatBdt } from "@/lib/services/rules/money";
import type { MoneyValue } from "@/lib/services/rules/money";

// BDT with lakh grouping (`৳1,25,000.00`, D-018), formatted by the M04 rule so the UI and the tests agree.
// Accepts the API's money strings ("160000.00") as well as Decimals.

export function Money({ value, className }: { value: MoneyValue; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatBdt(value)}</span>;
}
