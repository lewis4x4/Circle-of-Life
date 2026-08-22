import TrialBalancePageClient from "@/components/finance/TrialBalancePageClient";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import {
  loadFinanceEntities,
  loadTrialBalanceData,
  type EntityMini,
  type TrialBalanceRow,
} from "@/lib/finance/load-trial-balance-data";
import { createClient } from "@/lib/supabase/server";

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const dateTo = todayFacilityDateIso();
  return { dateFrom: `${dateTo.slice(0, 7)}-01`, dateTo };
}

export default async function TrialBalancePage() {
  const roleContext = await loadFinanceRoleContextServer();
  const { dateFrom, dateTo } = defaultDateRange();

  if (!roleContext.ok) {
    return (
      <TrialBalancePageClient
        initialEntities={[]}
        initialEntityId=""
        initialDateFrom={dateFrom}
        initialDateTo={dateTo}
        initialRows={[]}
        initialError={roleContext.error}
        initialReady={false}
      />
    );
  }

  const supabase = await createClient();
  let initialEntities: EntityMini[] = [];
  let initialEntityId = "";
  let initialRows: TrialBalanceRow[] = [];
  let initialError: string | null = null;

  try {
    initialEntities = await loadFinanceEntities(supabase, roleContext.ctx.organizationId);
    initialEntityId = initialEntities[0]?.id ?? "";
    if (initialEntityId) {
      initialRows = await loadTrialBalanceData(supabase, initialEntityId, dateFrom, dateTo);
    }
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : "Failed to load trial balance.";
  }

  return (
    <TrialBalancePageClient
      initialEntities={initialEntities}
      initialEntityId={initialEntityId}
      initialDateFrom={dateFrom}
      initialDateTo={dateTo}
      initialRows={initialRows}
      initialError={initialError}
      initialReady
    />
  );
}
