import { ExecutiveOverviewPageClient } from "@/components/executive/ExecutiveOverviewPageClient";
import type { ExecutiveOverviewData } from "@/lib/executive/load-executive-overview";
import { EMPTY_PRESENCE_CENSUS } from "@/lib/executive/presence-census";

const EMPTY_DATA: ExecutiveOverviewData = {
  metrics: {},
  alerts: [],
  facilities: [],
  assuranceHeatMap: [],
  assuranceTrends: [],
  presenceCensus: EMPTY_PRESENCE_CENSUS,
  occupancyContext: null,
};


/** Data-free HTML can be served immediately; scoped reads start after browser auth. */
export default function ExecutiveOverviewPage() {
  return (
    <ExecutiveOverviewPageClient
      initialMetrics={EMPTY_DATA.metrics}
      initialAlerts={EMPTY_DATA.alerts}
      initialFacilities={EMPTY_DATA.facilities}
      initialAssuranceHeatMap={EMPTY_DATA.assuranceHeatMap}
      initialAssuranceTrends={EMPTY_DATA.assuranceTrends}
      initialPresenceCensus={EMPTY_DATA.presenceCensus}
      initialOccupancyContext={EMPTY_DATA.occupancyContext}
      initialHasServerData={false}
    />
  );
}
