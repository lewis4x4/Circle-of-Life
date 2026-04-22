/**
 * Dietary dashboard brief.
 * Census, special diets, meals today, diet changes in the last 48h.
 */

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

type CountResponse = { count: number | null };
type ScopedQuery<T> = { eq(column: string, value: string): T };
type RecentDietChangeRow = {
  id: string;
  diet_type: string | null;
  updated_at: string;
  residents: { first_name: string | null; last_name: string | null } | null;
};
type DietBreakdownRow = { diet_type: string | null };

export async function fetchDietaryDashboardBrief(
  facilityId: string | null,
): Promise<DietaryDashboardBrief> {
  const supabase = createClient();

  const f = <T extends ScopedQuery<T>>(q: T): T =>
    isValidFacilityIdForQuery(facilityId) ? q.eq("facility_id", facilityId) : q;

  const todayStart = new Date().toISOString().split("T")[0] + "T00:00:00";
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

  const recentDietChanges = ((recentChangesRes.data ?? []) as RecentDietChangeRow[]).map((dietChange) => ({
    id: dietChange.id,
    residentName:
      `${dietChange.residents?.first_name ?? ""} ${dietChange.residents?.last_name ?? ""}`.trim() || "Unknown",
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
    censusCount: (censusRes as CountResponse).count ?? 0,
    specialDiets: (specialDietsRes as CountResponse).count ?? 0,
    mealsToday: (mealsRes as CountResponse).count ?? 0,
    dietChanges48h: (changesRes as CountResponse).count ?? 0,
    recentDietChanges,
    specialDietBreakdown,
  };
}
