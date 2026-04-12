/**
 * exec-scenario-solver — Financial scenario projector for Haven Executive Intelligence.
 *
 * POST { assumptions: {...}, facility_id?: string }
 * Auth: JWT (owner / org_admin only)
 *
 * Fetches current KPIs as baseline, then projects revenue, labor, NOI, and cash
 * flow month-by-month using the supplied assumptions.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  computeKpiForFacilityIds,
  loadFacilitiesForOrganization,
} from "../_shared/exec-kpi-metrics.ts";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ROLES = ["owner", "org_admin"];
const BLENDED_RATE = 3800; // $/bed/month (private + Medicaid blend)
const OTHER_OPEX_RATIO = 0.20;
const DEFAULT_LABOR_RATIO = 0.55; // labor as fraction of revenue baseline

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type Assumptions = {
  occupancy_pct: number;       // target occupancy (0-1)
  revenue_growth_pct: number;  // annual revenue growth (0.05 = 5%)
  labor_inflation_pct: number; // annual labor inflation (0.03 = 3%)
  new_beds: number;            // beds added over the horizon
  time_horizon_months: number; // projection length
};

type MonthProjection = {
  month: number;
  revenue: number;
  labor: number;
  other_opex: number;
  noi: number;
  cash_flow: number;
  occupancy: number;
  beds: number;
};

/* ------------------------------------------------------------------ */
/*  Main handler                                                      */
/* ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  const t = withTiming("exec-scenario-solver");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  // --- Auth ---
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user) {
    t.log({ event: "auth_failed", outcome: "blocked" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  // --- Parse body ---
  let body: { assumptions?: Assumptions; facility_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const a = body.assumptions;
  if (
    !a ||
    typeof a.occupancy_pct !== "number" ||
    typeof a.revenue_growth_pct !== "number" ||
    typeof a.labor_inflation_pct !== "number" ||
    typeof a.new_beds !== "number" ||
    typeof a.time_horizon_months !== "number"
  ) {
    return jsonResponse({ error: "assumptions object with all required fields is required" }, 400, origin);
  }
  if (a.time_horizon_months < 1 || a.time_horizon_months > 120) {
    return jsonResponse({ error: "time_horizon_months must be 1-120" }, 400, origin);
  }

  // --- Profile + role check ---
  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role, organization_id")
    .eq("id", user.id)
    .single();

  const role = String(profile?.app_role ?? user.app_metadata?.app_role ?? "caregiver");
  const organizationId = profile?.organization_id as string | undefined;

  if (!organizationId) {
    return jsonResponse({ error: "Profile has no organization" }, 403, origin);
  }
  if (!ALLOWED_ROLES.includes(role)) {
    t.log({ event: "role_denied", outcome: "blocked", role });
    return jsonResponse({ error: "Insufficient permissions" }, 403, origin);
  }

  // --- Load facilities + baseline KPIs ---
  try {
    const allFacilities = await loadFacilitiesForOrganization(admin, organizationId);
    const facilities = body.facility_id
      ? allFacilities.filter((f) => f.id === body.facility_id)
      : allFacilities;

    if (facilities.length === 0) {
      return jsonResponse({ error: "No matching facilities" }, 404, origin);
    }

    const baseline = await computeKpiForFacilityIds(admin, organizationId, facilities);

    const currentBeds = baseline.census.licensedBeds;
    const currentOccupancy = (baseline.census.occupancyPct ?? 0) / 100;
    const occupiedNow = baseline.census.occupiedResidents;

    // Derive baseline financials from bed count and blended rate
    const baseRevenue = occupiedNow * BLENDED_RATE;
    const baseLabor = baseRevenue * DEFAULT_LABOR_RATIO;
    const baseOtherOpex = baseRevenue * OTHER_OPEX_RATIO;
    const baseDebtService = baseRevenue * 0.05; // ~5% of revenue as placeholder

    // --- Project month-by-month ---
    const projections: MonthProjection[] = [];
    const horizon = a.time_horizon_months;
    const monthlyRevenueGrowth = a.revenue_growth_pct / 12;
    const monthlyLaborInflation = a.labor_inflation_pct / 12;
    const monthlyOtherInflation = 0.02 / 12; // 2% annual

    let breakEvenMonth: number | null = null;

    for (let m = 1; m <= horizon; m++) {
      const projectedBeds = currentBeds + Math.round(a.new_beds * (m / horizon));
      const projectedOccupancy = Math.min(a.occupancy_pct, 1.0);
      const occupiedBeds = Math.round(projectedBeds * projectedOccupancy);

      const revenue = occupiedBeds * BLENDED_RATE * Math.pow(1 + monthlyRevenueGrowth, m);
      const labor = baseLabor * Math.pow(1 + monthlyLaborInflation, m);
      const otherOpex = revenue * OTHER_OPEX_RATIO * Math.pow(1 + monthlyOtherInflation, m);
      const noi = revenue - labor - otherOpex;
      const cashFlow = noi - baseDebtService;

      if (breakEvenMonth === null && cashFlow > 0) {
        breakEvenMonth = m;
      }

      projections.push({
        month: m,
        revenue: Math.round(revenue),
        labor: Math.round(labor),
        other_opex: Math.round(otherOpex),
        noi: Math.round(noi),
        cash_flow: Math.round(cashFlow),
        occupancy: projectedOccupancy,
        beds: projectedBeds,
      });
    }

    const last = projections[projections.length - 1]!;

    t.log({
      event: "scenario_completed",
      outcome: "success",
      horizon,
      facilities_count: facilities.length,
    });

    return jsonResponse(
      {
        ok: true,
        baseline: {
          beds: currentBeds,
          occupancy: currentOccupancy,
          occupied_beds: occupiedNow,
          estimated_monthly_revenue: Math.round(baseRevenue),
          estimated_monthly_labor: Math.round(baseLabor),
          estimated_monthly_noi: Math.round(baseRevenue - baseLabor - baseOtherOpex),
        },
        projections,
        summary: {
          projected_noi: last.noi,
          projected_cash_flow: last.cash_flow,
          break_even_month: breakEvenMonth,
        },
      },
      200,
      origin,
    );
  } catch (err) {
    t.log({ event: "scenario_failed", outcome: "error", error_message: String(err) });
    return jsonResponse({ error: "Scenario computation failed" }, 500, origin);
  }
});
