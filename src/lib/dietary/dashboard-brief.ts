/**
 * Dietary dashboard brief.
 * Census, special diets, meals today, diet changes in the last 48h.
 */

import { formatDietaryDashboardBriefResidentName } from "@/lib/dietary/dashboard-brief-display-copy";
import {
  facilityDatetimeLocalToUtcIso,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";
import { requireHeadCount, type HeadCountResponse } from "@/lib/metrics/require-head-count";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type DietaryDashboardBrief = {
  censusCount: number;
  specialDiets: number;
  mealsToday: number;
  dietChanges48h: number;
  recentDietChanges: Array<{
    id: string;
    residentName: string;
    changeType: string;
    changedAt: string;
  }>;
  specialDietBreakdown: Array<{
    dietType: string;
    count: number;
  }>;
};

type ScopedQuery<T> = { eq(column: string, value: string): T };
type RecentDietChangeRow = {
  id: string;
  diet_type: string | null;
  updated_at: string;
  residents: { first_name: string | null; last_name: string | null } | null;
};
type DietBreakdownRow = { diet_type: string | null };

/** Start of the dietary operator's Eastern today, represented for UTC timestamptz queries. */
export function dietaryMealsTodayStartUtcIso(now: Date = new Date()): string {
  return facilityDatetimeLocalToUtcIso(`${todayFacilityDateIso(now)}T00:00`);
}

export async function fetchDietaryDashboardBrief(
  facilityId: string | null,
  supabase = createClient(),
): Promise<DietaryDashboardBrief> {
  const f = <T extends ScopedQuery<T>>(q: T): T =>
    isValidFacilityIdForQuery(facilityId) ? q.eq("facility_id", facilityId) : q;

  const todayStart = dietaryMealsTodayStartUtcIso();
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600000).toISOString();

  const [
    censusRes,
    specialDietsRes,
    mealsRes,
    changesRes,
    recentChangesRes,
    breakdownRes,
  ] = await Promise.all([
    f(supabase.from("residents" as never).select("id", { count: "exact", head: true }))
      .eq("status", "active")
      .is("deleted_at", null),
    f(supabase.from("diet_orders" as never).select("id", { count: "exact", head: true }))
      .eq("status", "active")
      .is("deleted_at", null),
    f(supabase.from("meal_service_records" as never).select("id", { count: "exact", head: true }))
      .gte("served_at", todayStart)
      .is("deleted_at", null),
    f(supabase.from("diet_orders" as never).select("id", { count: "exact", head: true }))
      .gte("updated_at", fortyEightHoursAgo)
      .is("deleted_at", null),
    f(supabase.from("diet_orders" as never).select("id, diet_type, updated_at, residents(first_name, last_name)"))
      .gte("updated_at", fortyEightHoursAgo)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(5),
    f(supabase.from("diet_orders" as never).select("diet_type"))
      .eq("status", "active")
      .is("deleted_at", null),
  ]);

  // A failed read throws rather than reading as "no diet orders" (COL-649).
  if (recentChangesRes.error) throw recentChangesRes.error;
  if (breakdownRes.error) throw breakdownRes.error;

  const recentDietChanges = ((recentChangesRes.data ?? []) as RecentDietChangeRow[]).map((dietChange) => ({
    id: dietChange.id,
    residentName: formatDietaryDashboardBriefResidentName(dietChange.residents),
    changeType: dietChange.diet_type ?? "Diet update",
    changedAt: dietChange.updated_at,
  }));

  // Aggregate diet type breakdown
  const dietCounts: Record<string, number> = {};
  for (const row of (breakdownRes.data ?? []) as DietBreakdownRow[]) {
    const dt = row.diet_type ?? "Unspecified";
    dietCounts[dt] = (dietCounts[dt] || 0) + 1;
  }
  const specialDietBreakdown = Object.entries(dietCounts)
    .map(([dietType, count]) => ({ dietType, count }))
    .sort((a, b) => b.count - a.count);

  return {
    censusCount: requireHeadCount(censusRes as HeadCountResponse, "Census"),
    specialDiets: requireHeadCount(specialDietsRes as HeadCountResponse, "Special diets"),
    mealsToday: requireHeadCount(mealsRes as HeadCountResponse, "Meals today"),
    dietChanges48h: requireHeadCount(changesRes as HeadCountResponse, "Diet changes"),
    recentDietChanges,
    specialDietBreakdown,
  };
}
