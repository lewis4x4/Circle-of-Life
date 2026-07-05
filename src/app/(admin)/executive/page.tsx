import { ExecutiveOverviewPageClient } from "@/components/executive/ExecutiveOverviewPageClient";
import {
  loadExecutiveOverview,
  type ExecutiveOverviewData,
} from "@/lib/executive/load-executive-overview";
import { EMPTY_PRESENCE_CENSUS } from "@/lib/executive/presence-census";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { createClient } from "@/lib/supabase/server";

const EMPTY_DATA: ExecutiveOverviewData = {
  metrics: {},
  alerts: [],
  facilities: [],
  assuranceHeatMap: [],
  assuranceTrends: [],
  presenceCensus: EMPTY_PRESENCE_CENSUS,
};

export default async function ExecutiveOverviewPage() {
  const roleContext = await loadFinanceRoleContextServer({ authSource: "session" });

  if (!roleContext.ok) {
    return (
      <ExecutiveOverviewPageClient
        initialMetrics={EMPTY_DATA.metrics}
        initialAlerts={EMPTY_DATA.alerts}
        initialFacilities={EMPTY_DATA.facilities}
        initialAssuranceHeatMap={EMPTY_DATA.assuranceHeatMap}
        initialAssuranceTrends={EMPTY_DATA.assuranceTrends}
        initialPresenceCensus={EMPTY_DATA.presenceCensus}
        initialHasServerData={false}
      />
    );
  }

  const supabase = await createClient();
  let data: ExecutiveOverviewData = EMPTY_DATA;
  let hasServerData = false;

  try {
    data = await loadExecutiveOverview(supabase, roleContext.ctx.organizationId);
    // Mark "has server data" only when at least one scoped live dataset is
    // non-empty. Empty installs render blanks; demo fallback is intentionally
    // disabled globally.
    hasServerData =
      Object.keys(data.metrics).length > 0 ||
      data.alerts.length > 0 ||
      data.facilities.length > 0 ||
      data.assuranceHeatMap.length > 0 ||
      data.assuranceTrends.length > 0;
  } catch {
    data = EMPTY_DATA;
    hasServerData = false;
  }

  return (
    <ExecutiveOverviewPageClient
      initialMetrics={data.metrics}
      initialAlerts={data.alerts}
      initialFacilities={data.facilities}
      initialAssuranceHeatMap={data.assuranceHeatMap}
      initialAssuranceTrends={data.assuranceTrends}
      initialPresenceCensus={data.presenceCensus}
      initialHasServerData={hasServerData}
    />
  );
}
