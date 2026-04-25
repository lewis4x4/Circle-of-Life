import { createClient } from "@/lib/supabase/server";

import type { V2ThresholdLoad, V2ThresholdRow } from "./v2-thresholds-types";

export type { V2ThresholdLoad, V2ThresholdRow } from "./v2-thresholds-types";
export { V2_THRESHOLD_METRIC_CATALOG } from "./v2-thresholds-types";

type FacilityRow = {
  id: string;
  name: string;
  organization_id: string;
};

type ThresholdRow = {
  facility_id: string;
  organization_id: string;
  metric_key: string;
  target_value: number;
  direction: "up" | "down";
  warning_band_pct: number | null;
};

type FacilitiesResult = { data: FacilityRow[] | null; error: { message: string } | null };
type ThresholdsResult = { data: ThresholdRow[] | null; error: { message: string } | null };

export async function loadV2Thresholds(): Promise<V2ThresholdLoad> {
  const supabase = await createClient();

  const facilitiesResult = (await supabase
    .from("facilities" as never)
    .select("id, name, organization_id")
    .is("deleted_at" as never, null as never)
    .order("name" as never, { ascending: true })) as unknown as FacilitiesResult;

  const thresholdsResult = (await supabase
    .from("facility_metric_targets" as never)
    .select(
      "facility_id, organization_id, metric_key, target_value, direction, warning_band_pct",
    )
    .is("deleted_at" as never, null as never)) as unknown as ThresholdsResult;

  const facilities = (facilitiesResult.data ?? []).map((row) => ({
    id: row.id,
    name: (row.name ?? "").trim() || "Unnamed facility",
    organizationId: row.organization_id,
  }));

  const facilityNameById = new Map(facilities.map((f) => [f.id, f.name]));

  const thresholds: V2ThresholdRow[] = (thresholdsResult.data ?? []).map((row) => ({
    facilityId: row.facility_id,
    facilityName: facilityNameById.get(row.facility_id) ?? "—",
    organizationId: row.organization_id,
    metricKey: row.metric_key,
    targetValue: Number(row.target_value),
    direction: row.direction,
    warningBandPct: row.warning_band_pct == null ? 10 : Number(row.warning_band_pct),
  }));

  return { facilities, thresholds };
}
