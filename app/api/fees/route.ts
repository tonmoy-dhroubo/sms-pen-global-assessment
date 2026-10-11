import { route } from "@/lib/api/handler";
import { listBalances } from "@/lib/services/fees";
import { balancesQuerySchema, type BalancesQuery } from "@/lib/validation/fees";

// Staff only. Students with a balance (owing or in credit), filtered by fee state, ageing bucket and programme.
export const GET = route<"staff", Record<string, never>, BalancesQuery>(
  { access: "staff", query: balancesQuerySchema },
  ({ query }) => listBalances(query),
);
