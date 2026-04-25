import { createClient } from "@/lib/supabase/server";

import {
  getV2DashboardPayload,
  type V2DashboardId,
  type V2DashboardPayload,
  type V2DashboardTableRow,
} from "./v2-dashboards";

export type V2DashboardScopeOption = { id: string; label: string };

export type V2DashboardLoad = {
  payload: V2DashboardPayload;
  facilities: V2DashboardScopeOption[];
  generatedAt: string;
  /** "live" → table rows came from haven.vw_v2_facility_rollup;
   *  "fixture" → view returned 0 rows or errored; UI uses fixture data. */
  rowsSource: "live" | "fixture";
};

type RollupRow = {
  facility_id: string;
  facility_name: string;
  occupancy_pct: number | null;
  open_incidents_count: number | null;
  survey_readiness_pct: number | null;
};

type ViewResult = { data: RollupRow[] | null; error: { message: string } | null };

/**
 * Server-side dashboard loader.
 *
 * 1. Pulls the static T1 payload contract (KPIs / panels / alerts /
 *    actionQueue / thresholds) from `getV2DashboardPayload` — those values
 *    remain fixture-driven in S8.5; their backing aggregates land in later
 *    slices.
 * 2. Reads `haven.vw_v2_facility_rollup` under the caller's RLS to populate
 *    the table rows with real per-facility data.
 * 3. Falls back to the static fixture rows if the view returns 0 rows or
 *    errors (e.g., during local dev against a dump that predates 211).
 */
export async function loadV2Dashboard(
  id: V2DashboardId,
): Promise<V2DashboardLoad | null> {
  const payload = getV2DashboardPayload(id);
  if (!payload) return null;

  const supabase = await createClient();

  const result = (await supabase
    .schema("haven" as never)
    .from("vw_v2_facility_rollup" as never)
    .select(
      "facility_id, facility_name, occupancy_pct, open_incidents_count, survey_readiness_pct",
    )
    .order("facility_name" as never, { ascending: true })) as unknown as ViewResult;

  let liveRows: V2DashboardTableRow[] | null = null;
  if (!result.error && Array.isArray(result.data) && result.data.length > 0) {
    liveRows = result.data.map((row) => ({
      id: row.facility_id,
      name: (row.facility_name ?? "").trim() || "Unnamed facility",
      occupancyPct: normalizePercent(row.occupancy_pct),
      laborCostPct: null, // Source aggregate lands in payroll/finance modules.
      openIncidents: row.open_incidents_count ?? 0,
      surveyReadinessPct: normalizePercent(row.survey_readiness_pct),
    }));
  }

  const tableRows = liveRows ?? payload.tableRows;
  const rowsSource: "live" | "fixture" = liveRows ? "live" : "fixture";

  // Build the scope option list from whichever rows we used so they always
  // line up — caller's accessible facility set IS the live view's row set.
  const facilities: V2DashboardScopeOption[] = tableRows.map((row) => ({
    id: row.id,
    label: row.name,
  }));

  return {
    payload: {
      ...payload,
      tableRows,
    },
    facilities,
    generatedAt: payload.generatedAt,
    rowsSource,
  };
}

/**
 * Convert a percent-bearing column to a 0–100 numeric. The DB stores some
 * percent columns as 0–1 fractions (e.g., `target_occupancy_pct = 0.95`); the
 * UI surface assumes 0–100. Values already > 1 are passed through unchanged.
 */
function normalizePercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value <= 1 ? Math.round(value * 1000) / 10 : value;
}
