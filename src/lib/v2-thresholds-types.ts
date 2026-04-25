/**
 * Pure-type module for the V2 thresholds settings editor.
 *
 * Separated from `./v2-thresholds.ts` so the client editor component can
 * import this without dragging the server-side Supabase loader into the
 * browser bundle (`@/lib/supabase/server` cannot run in client components).
 */

export type V2ThresholdRow = {
  facilityId: string;
  facilityName: string;
  organizationId: string;
  metricKey: string;
  targetValue: number;
  direction: "up" | "down";
  warningBandPct: number;
};

export type V2ThresholdLoad = {
  facilities: Array<{
    id: string;
    name: string;
    organizationId: string;
  }>;
  thresholds: V2ThresholdRow[];
};

export const V2_THRESHOLD_METRIC_CATALOG: ReadonlyArray<{
  key: string;
  label: string;
  defaultDirection: "up" | "down";
  unit: string;
}> = [
  { key: "occupancy_pct", label: "Occupancy %", defaultDirection: "up", unit: "%" },
  { key: "labor_cost_pct", label: "Labor cost %", defaultDirection: "down", unit: "%" },
  { key: "open_incidents", label: "Open incidents", defaultDirection: "down", unit: "" },
  { key: "survey_readiness_pct", label: "Survey readiness %", defaultDirection: "up", unit: "%" },
];
