import { ChargeKindBadge } from "@/components/fees/charge-kind-badge";
import { DateTime } from "@/components/format/date-time";
import { Money } from "@/components/format/money";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MyChargeDto } from "@/lib/services/fees";

// The student's charges, oldest due date first: programme fee instalments, adjustments and waivers. A waiver is labelled
// "Waiver" and its amount is negative, as it reduces what is owed. Nothing here says which staff member added a row.

export function MyChargesTable({ charges }: { charges: MyChargeDto[] }) {
  if (charges.length === 0) {
    return (
      <EmptyState
        title="No charges yet"
        description="Your charges appear here once the Registry has billed your programme fees."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <caption className="sr-only">Your charges</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Description</TableHead>
            <TableHead scope="col">Type</TableHead>
            <TableHead scope="col">Due</TableHead>
            <TableHead scope="col" className="text-right">
              Amount
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {charges.map((charge) => (
            <TableRow key={charge.id} data-kind={charge.kind}>
              <TableCell className="min-w-40 whitespace-normal">
                <span className="block break-words">{charge.description}</span>
                <span className="block text-xs text-muted-foreground">{charge.academicYear}</span>
              </TableCell>
              <TableCell>
                <ChargeKindBadge kind={charge.kind} />
              </TableCell>
              <TableCell>
                <DateTime value={charge.dueDate} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={charge.amount} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
