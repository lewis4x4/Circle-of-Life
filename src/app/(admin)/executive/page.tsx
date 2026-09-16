import { ExecutiveOverviewPageClient } from "@/components/executive/ExecutiveOverviewPageClient";
import type { ExecutiveOverviewData } from "@/lib/executive/load-executive-overview";
import { EMPTY_PRESENCE_CENSUS } from "@/lib/executive/presence-census";
import { facilityTodayIsoDate } from "@/lib/executive/snapshot-evidence";

const EMPTY_DATA: ExecutiveOverviewData = {
  metrics: {},
  alerts: [],
  facilities: [],
  assuranceHeatMap: [],
  assuranceTrends: [],
  presenceCensus: EMPTY_PRESENCE_CENSUS,
  occupancyContext: null,
  snapshot: { kind: "never_recorded" },
  metricChanges: {},
  metricDates: {},
  todayIsoDate: facilityTodayIsoDate(),
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
      initialSnapshot={EMPTY_DATA.snapshot}
      initialMetricChanges={EMPTY_DATA.metricChanges}
      initialMetricDates={EMPTY_DATA.metricDates}
      initialHasServerData={false}
    />
  );
}
