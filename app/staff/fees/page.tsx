import type { Metadata } from "next";
import { BalancesFilters } from "@/components/fees/balances-filters";
import { BalancesTable } from "@/components/fees/balances-table";
import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatSort } from "@/lib/list-params";
import { requireStaffPage } from "@/lib/page-guards";
import { listBalances } from "@/lib/services/fees";
import { listProgrammes } from "@/lib/services/programmes";
import { balancesQuerySchema } from "@/lib/validation/fees";

export const metadata: Metadata = { title: "Fees" };

type SearchParams = Record<string, string | string[] | undefined>;

// The fees overview (pages.md `/staff/fees`): every student who owes money or holds a credit, with overdue amount and
// age, filterable by fee state, ageing bucket and programme. Reads the same URL params the API does, through the same
// schema.
export default async function FeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaffPage();

  const parsed = balancesQuerySchema.safeParse(await searchParams);
  // A hand-edited address with a bad value shows the default list and says so, rather than an error page.
  const query = parsed.success ? parsed.data : balancesQuerySchema.parse({});

  // The export is the overdue list; it follows the programme and ageing filters the page is showing.
  const exportParams = new URLSearchParams();
  if (query.programmeId) exportParams.set("programmeId", query.programmeId);
  if (query.ageingBucket) exportParams.set("ageingBucket", query.ageingBucket);
  const exportHref = `/api/exports/overdue.csv${exportParams.size > 0 ? `?${exportParams}` : ""}`;

  const [list, programmes] = await Promise.all([listBalances(query), listProgrammes()]);

  return (
    <div className="space-y-6">
      <PageHeader
        actions={<ExportCsvButton href={exportHref} label="Export CSV: overdue list" />}
        title="Fees"
        description="Everyone who owes money or holds a credit. Overdue means a charge fell due and is not covered by payments; outstanding means money is owed but nothing is due yet."
      />

      {!parsed.success ? (
        <Alert>
          <AlertDescription>
            Some filter values in the address were not understood and were ignored.
          </AlertDescription>
        </Alert>
      ) : null}

      <BalancesFilters programmes={programmes} />

      <BalancesTable
        items={list.items}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        sort={formatSort(query.sort) ?? "-oldestOverdueDays"}
        filtered={Boolean(query.feeState || query.ageingBucket || query.programmeId)}
      />
    </div>
  );
}
