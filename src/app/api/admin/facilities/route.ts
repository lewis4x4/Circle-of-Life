/**
 * GET /api/admin/facilities — List facilities with summary stats, pagination.
 */

import { NextRequest, NextResponse } from "next/server";
import { listActorAccessibleFacilityIds, requireAdminApiActor } from "@/lib/admin/api-auth";
import { listFacilitiesQuerySchema } from "@/lib/validation/facility-admin";

import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";
import { portfolioOccupancyPercent } from "@/lib/admin/facilities/portfolio-metrics";

function pickSurveyReadinessPct(summaryJson: unknown): number | null {
  if (!summaryJson || typeof summaryJson !== "object") return null;
  const raw = (summaryJson as Record<string, unknown>).survey_readiness_pct;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(100, raw));
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  return null;
}

type StaffAdminRow = {
  id: string;
  facility_id: string;
  first_name: string | null;
  last_name: string | null;
};

function resolveFacilityAdministrator(
  facilityId: string,
  admins: StaffAdminRow[],
  storedAdministratorName: string | null | undefined,
): { name: string | null; staffId: string | null } {
  const atSite = admins.filter((s) => s.facility_id === facilityId);
  atSite.sort(
    (a, b) =>
      (a.last_name ?? "").localeCompare(b.last_name ?? "", undefined, { sensitivity: "base" }) ||
      (a.first_name ?? "").localeCompare(b.first_name ?? "", undefined, { sensitivity: "base" }),
  );
  const top = atSite[0];
  if (top) {
    const nm = `${top.first_name ?? ""} ${top.last_name ?? ""}`.trim();
    return { name: nm || null, staffId: top.id };
  }
  const stored = storedAdministratorName?.trim();
  return { name: stored || null, staffId: null };
}

// ── GET: List Facilities ──────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiActor();
  if ("response" in auth) {
    return auth.response;
  }
  const { actor } = auth;
  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);

  // Parse query params
  const url = new URL(request.url);
  const rawParams: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, key) => {
    const existing = rawParams[key];
    if (existing) {
      rawParams[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      rawParams[key] = value;
    }
  });

  const parsed = listFacilitiesQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { page, page_size, search, status, county, sort_by, sort_order } = parsed.data;
  const offset = (page - 1) * page_size;

  // Build query (Supabase client infers chain type)
  let query = admin
    .from("facilities")
    .select(
      "id, name, phone, email, address_line_1, city, state, zip, county, total_licensed_beds, status, created_at, organization_id, administrator_name",
      { count: "exact" },
    )
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null);

  const accessibleFacilityIds = await listActorAccessibleFacilityIds(actor);
  if (accessibleFacilityIds.length === 0) {
    return NextResponse.json({
      facilities: [],
      total: 0,
      page,
      has_next: false,
    });
  }

  if (!["owner", "org_admin"].includes(actor.app_role)) {
    query = query.in("id", accessibleFacilityIds);
  }

  // Status filter
  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  // County filter
  if (county) {
    query = query.eq("county", county);
  }

  // Search
  if (search) {
    query = query.or(`name.ilike.%${search}%,city.ilike.%${search}%`);
  }

  // Sort (occupancy_pct is computed post-fetch, not a DB column)
  const sortByDb =
    sort_by === "occupancy_pct" ? ("name" as const) : (sort_by as "name" | "total_licensed_beds" | "created_at");
  query = query.order(sortByDb, { ascending: sort_order === "asc" });
  query = query.range(offset, offset + page_size - 1);

  const { data: facilities, count, error: queryErr } = await query;
  if (queryErr) {
    return NextResponse.json({ error: "Failed to fetch facilities" }, { status: 500 });
  }

  // Fetch occupancy stats and alerts for each facility
  const facilityIds = (facilities ?? []).map((f) => f.id);
  const statsMap: Record<
    string,
    {
      occupancy_count: number;
      total_beds: number;
      occupancy_pct: number;
      alert_count: number;
    }
  > = {};

  const incidentsByFacility = new Map<string, { open: number; open_level_3: number }>();
  const surveyPctByFacility = new Map<string, number>();
  const administratorsByFacility: StaffAdminRow[] = [];

  if (facilityIds.length > 0) {
    const orgId = actor.organization_id!;
    const [bedsRes, alertsRes, incRes, admRes, riskRes] = await Promise.all([
      untypedAdmin.from("beds").select("facility_id, is_occupied").in("facility_id", facilityIds),
      untypedAdmin
        .from("facility_operational_thresholds")
        .select("facility_id")
        .in("facility_id", facilityIds)
        .eq("enabled", true),
      untypedAdmin
        .from("incidents")
        .select("facility_id, status, severity")
        .eq("organization_id", orgId)
        .in("facility_id", facilityIds)
        .is("deleted_at", null),
      untypedAdmin
        .from("staff")
        .select("id, facility_id, first_name, last_name")
        .in("facility_id", facilityIds)
        .eq("staff_role", "administrator")
        .eq("employment_status", "active")
        .is("deleted_at", null),
      untypedAdmin
        .from("risk_score_snapshots")
        .select("facility_id, computed_at, summary_json")
        .eq("organization_id", orgId)
        .in("facility_id", facilityIds)
        .is("deleted_at", null)
        .order("computed_at", { ascending: false }),
    ]);

    const typedBeds =
      (((bedsRes as { data?: unknown }).data ?? []) as unknown as Array<{
        facility_id: string;
        is_occupied: boolean;
      }>) ?? [];

    for (const bed of typedBeds) {
      if (!statsMap[bed.facility_id]) {
        statsMap[bed.facility_id] = {
          occupancy_count: 0,
          total_beds: 0,
          occupancy_pct: 0,
          alert_count: 0,
        };
      }
      statsMap[bed.facility_id].total_beds++;
      if (bed.is_occupied) statsMap[bed.facility_id].occupancy_count++;
    }

    const typedAlerts =
      (((alertsRes as { data?: unknown }).data ?? []) as unknown as Array<{ facility_id: string }>) ?? [];

    for (const alert of typedAlerts) {
      if (!statsMap[alert.facility_id]) {
        statsMap[alert.facility_id] = {
          occupancy_count: 0,
          total_beds: 0,
          occupancy_pct: 0,
          alert_count: 0,
        };
      }
      statsMap[alert.facility_id].alert_count++;
    }

    const incRows =
      (((incRes as { data?: unknown }).data ?? []) as unknown as Array<{
        facility_id: string;
        status: string;
        severity: string;
      }>) ?? [];

    for (const inc of incRows) {
      if (inc.status === "closed" || inc.status === "resolved") continue;
      const cur = incidentsByFacility.get(inc.facility_id) ?? { open: 0, open_level_3: 0 };
      cur.open += 1;
      if (inc.severity === "level_3") cur.open_level_3 += 1;
      incidentsByFacility.set(inc.facility_id, cur);
    }

    administratorsByFacility.push(
      ...((((admRes as { data?: unknown }).data ?? []) as unknown as StaffAdminRow[]) ?? []),
    );

    const riskRows =
      (((riskRes as { data?: unknown }).data ?? []) as unknown as Array<{
        facility_id: string;
        summary_json: unknown;
      }>) ?? [];

    for (const rr of riskRows) {
      if (surveyPctByFacility.has(rr.facility_id)) continue;
      const pct = pickSurveyReadinessPct(rr.summary_json);
      if (pct != null) surveyPctByFacility.set(rr.facility_id, pct);
    }
  }

  let data = (facilities ?? []).map((f) => {
    const row = f as {
      id: string;
      total_licensed_beds?: number;
      administrator_name?: string | null;
    };
    const licensed = typeof row.total_licensed_beds === "number" ? row.total_licensed_beds : 0;
    const stats = statsMap[row.id] ?? {
      occupancy_count: 0,
      total_beds: 0,
      occupancy_pct: 0,
      alert_count: 0,
    };

    const phy = stats.total_beds;

    const occupancy_pct = portfolioOccupancyPercent(stats.occupancy_count, phy, licensed);
    const inc = incidentsByFacility.get(row.id) ?? { open: 0, open_level_3: 0 };

    const { name: administrator_name, staffId: administrator_staff_id } = resolveFacilityAdministrator(
      row.id,
      administratorsByFacility,
      row.administrator_name ?? null,
    );

    const survey_readiness_pct = surveyPctByFacility.has(row.id) ? surveyPctByFacility.get(row.id)! : null;

    return {
      ...row,
      occupancy_count: stats.occupancy_count,
      total_beds: phy,
      occupancy_pct,
      alert_count: stats.alert_count,
      portfolio_open_incidents_total: inc.open,
      portfolio_open_incidents_level_3: inc.open_level_3,
      survey_readiness_pct,
      administrator_name,
      administrator_staff_id,
      labor_cost_mtd_pct: null as number | null,
    };
  });

  if (sort_by === "occupancy_pct") {
    data = [...data].sort((a, b) => {
      const pa = a.occupancy_pct ?? 0;
      const pb = b.occupancy_pct ?? 0;
      return sort_order === "asc" ? pa - pb : pb - pa;
    });
  }

  return NextResponse.json({
    facilities: data,
    total: count ?? 0,
    page,
    has_next: offset + page_size < (count ?? 0),
  });
}
