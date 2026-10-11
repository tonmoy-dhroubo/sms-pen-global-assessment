import { DateTime } from "@/components/format/date-time";
import { Money } from "@/components/format/money";
import { ChargeKindBadge } from "@/components/fees/charge-kind-badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ChargeDto } from "@/lib/services/fees";

// A student's charges, oldest due date first: the programme fee instalments, adjustments and waivers. A waiver's
// amount is negative, as stored.

export function ChargesTable({ charges }: { charges: ChargeDto[] }) {
  if (charges.length === 0) {
    return (
      <EmptyState
        title="No charges yet"
        description="Charges are created from the programme's fee schedule when a student is enrolled. If the programme has no schedule for this session, add one on the Programmes page, or add an adjustment here."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <caption className="sr-only">Charges</caption>
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
            <TableRow key={charge.id}>
              <TableCell className="max-w-72 truncate" title={charge.description}>
                {charge.description}
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
