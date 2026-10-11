"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Money } from "@/components/format/money";
import { ReasonDialog } from "@/components/dialogs/reason-dialog";
import { Button } from "@/components/ui/button";
import { voidPaymentRequest } from "@/lib/client/fees";
import { formatBdt } from "@/lib/services/rules/money";

// "Void" on a payment row: asks for a reason, then voids it. The payment stays in the table, struck through; it just
// stops counting toward the balance (edge-cases.md "Mistaken payment").

export interface VoidPaymentButtonProps {
  paymentId: string;
  amount: string;
  reference: string;
}

export function VoidPaymentButton({ paymentId, amount, reference }: VoidPaymentButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Void<span className="sr-only"> payment {reference}</span>
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Void payment"
        description={
          <>
            Void the payment of <Money value={amount} /> (reference {reference}). It stays in the
            record, struck through, and no longer counts toward the balance. This cannot be undone.
          </>
        }
        reasonLabel="Why is it being voided?"
        reasonHint="Shown with the voided payment, for example: entered twice, wrong student, cheque bounced."
        confirmLabel="Void payment"
        destructive
        onSubmit={async (reason) => {
          const { summary } = await voidPaymentRequest(paymentId, { reason });
          toast.success("Payment voided.", {
            description: `The balance is now ${formatBdt(summary.balance)}.`,
          });
          router.refresh();
        }}
      />
    </>
  );
}
