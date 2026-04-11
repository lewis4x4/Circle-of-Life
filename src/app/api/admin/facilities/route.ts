/**
 * GET /api/admin/facilities — List facilities with summary stats, pagination.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { listFacilitiesQuerySchema } from "@/lib/validation/facility-admin";

// ── GET: List Facilities ──────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Auth
  const supabase = await createClient();
  const {
    data: { user },
    error: sessionErr,
  } = await supabase.auth.getUser();
  if (sessionErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Get actor profile
  const admin = createServiceRoleClient();
  const { data: actor, error: profileErr } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (profileErr || !actor) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

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
      "id, name, phone, email, address_line_1, city, state, zip, county, total_licensed_beds, status, created_at, organization_id",
      { count: "exact" },
    )
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null);

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

  if (facilityIds.length > 0) {
    // Get occupancy from beds
    const { data: beds } = await admin
      .from("beds")
      .select("facility_id, is_occupied")
      .in("facility_id", facilityIds);

    if (beds) {
      for (const bed of beds) {
        if (!statsMap[bed.facility_id]) {
          statsMap[bed.facility_id] = {
            occupancy_count: 0,
            total_beds: 0,
            occupancy_pct: 0,
            alert_count: 0,
          };
        }
        statsMap[bed.facility_id].total_beds++;
        if (bed.is_occupied) {
          statsMap[bed.facility_id].occupancy_count++;
        }
      }
    }

    // Get alert counts
    const { data: alerts } = await admin
      .from("facility_operational_thresholds")
      .select("facility_id")
      .in("facility_id", facilityIds)
      .eq("enabled", true);

    if (alerts) {
      for (const alert of alerts) {
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
    }

    // Calculate percentages
    for (const fid of facilityIds) {
      if (statsMap[fid]) {
        const stats = statsMap[fid];
        stats.occupancy_pct =
          stats.total_beds > 0 ? Math.round((stats.occupancy_count / stats.total_beds) * 100) : 0;
      }
    }
  }

  let data = (facilities ?? []).map((f) => {
    const row = f as { id: string; total_licensed_beds?: number };
    return {
      ...row,
      ...(statsMap[row.id] || {
        occupancy_count: 0,
        total_beds: row.total_licensed_beds || 0,
        occupancy_pct: 0,
        alert_count: 0,
      }),
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
