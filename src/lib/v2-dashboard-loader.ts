import { createClient } from "@/lib/supabase/server";

import {
  getV2DashboardPayload,
  type V2DashboardId,
  type V2DashboardPayload,
  type V2DashboardTableRow,
} from "./v2-dashboards";
import {
  buildV2PaginationMeta,
  resolveV2Pagination,
  type V2PaginationInput,
  type V2PaginationMeta,
} from "./v2-pagination";

export type V2DashboardScopeOption = { id: string; label: string };

export type V2DashboardRowsSource = "live" | "empty" | "unavailable";

export type V2DashboardLoad = {
  payload: V2DashboardPayload;
  facilities: V2DashboardScopeOption[];
  /**
   * Total non-deleted facilities visible to the caller under RLS, regardless
   * of whether they have rollup data yet. Drives the empty-install
   * onboarding copy ("5 facilities are in scope") since `facilities` only
   * contains rows the rollup view has data for and is 0 on empty installs.
   */
  orgFacilityCount: number;
  generatedAt: string;
  tablePagination: V2PaginationMeta;
  /**
   * "live" → table rows came from haven.vw_v2_facility_rollup.
   * "empty" → live view succeeded but returned no rows in scope.
   * "unavailable" → live view errored; no fallback rows are substituted.
   */
  rowsSource: V2DashboardRowsSource;
};

type RollupRow = {
  facility_id: string;
  facility_name: string;
  occupancy_pct: number | null;
  open_incidents_count: number | null;
  survey_readiness_pct: number | null;
};

type ViewResult = {
  data: RollupRow[] | null;
  count?: number | null;
  error: { message: string } | null;
};

/**
 * Server-side dashboard loader.
 *
 * 1. Pulls the T1 payload shell (labels, panels, thresholds) from
 *    `getV2DashboardPayload`. The shell has no baked-in KPI values, alerts,
 *    or facility rows.
 * 2. Reads `haven.vw_v2_facility_rollup` under the caller's RLS to populate
 *    the table rows with real per-facility data.
 * 3. Returns explicit empty/unavailable states when the view has no rows or
 *    errors. It never substitutes deterministic fallback rows.
 */
export async function loadV2Dashboard(
  id: V2DashboardId,
  options?: V2PaginationInput,
): Promise<V2DashboardLoad | null> {
  const payload = getV2DashboardPayload(id);
  if (!payload) return null;

  const supabase = await createClient();

  const facilityOptionsResult = (await supabase
    .schema("haven" as never)
    .from("vw_v2_facility_rollup" as never)
    .select("facility_id, facility_name")
    .order("facility_name" as never, { ascending: true })
    .order("facility_id" as never, { ascending: true })) as unknown as ViewResult;

  const range = resolveV2Pagination(options);
  const tableResult = (await supabase
    .schema("haven" as never)
    .from("vw_v2_facility_rollup" as never)
    .select(
      "facility_id, facility_name, occupancy_pct, open_incidents_count, survey_readiness_pct",
      { count: "exact" },
    )
    .order("facility_name" as never, { ascending: true })
    .order("facility_id" as never, { ascending: true })
    .range(range.from, range.to)) as unknown as ViewResult;

  let tableRows: V2DashboardTableRow[] = [];
  let rowsSource: V2DashboardRowsSource = "empty";

  const tablePagination = buildV2PaginationMeta(range, tableResult.count);

  if (tableResult.error) {
    rowsSource = "unavailable";
  } else if (Array.isArray(tableResult.data) && tableResult.data.length > 0) {
    rowsSource = "live";
    tableRows = tableResult.data.map((row) => ({
      id: row.facility_id,
      name: (row.facility_name ?? "").trim() || "Unnamed facility",
      occupancyPct: normalizePercent(row.occupancy_pct),
      laborCostPct: null, // Source aggregate lands in payroll/finance modules.
      openIncidents: row.open_incidents_count,
      surveyReadinessPct: normalizePercent(row.survey_readiness_pct),
    }));
  } else if (tablePagination.totalCount > 0) {
    rowsSource = "live";
  }

  // Caller-visible facility filters should only list facilities actually
  // returned by the live rollup view. Empty/unavailable means no hidden fallback
  // facility scope is presented.
  const facilities: V2DashboardScopeOption[] =
    rowsSource !== "unavailable" && Array.isArray(facilityOptionsResult.data)
      ? facilityOptionsResult.data.map((row) => ({
          id: row.facility_id,
          label: (row.facility_name ?? "").trim() || "Unnamed facility",
        }))
      : [];

  // Org-wide facility count for the empty-install onboarding copy. Counts
  // non-deleted facilities the caller can see via RLS. We `count: "exact"`
  // with `head: true` so no rows transit the wire — just the count header.
  const { count: orgFacilityCount } = await supabase
    .from("facilities")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);

  const generatedAt = new Date().toISOString();

  return {
    payload: {
      ...payload,
      generatedAt,
      tableRows,
    },
    facilities,
    orgFacilityCount: orgFacilityCount ?? 0,
    generatedAt,
    tablePagination,
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
