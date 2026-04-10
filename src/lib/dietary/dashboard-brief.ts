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

export async function fetchDietaryDashboardBrief(
  facilityId: string | null,
): Promise<DietaryDashboardBrief> {
  const supabase = createClient();

  const f = (q: any) =>
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

  const recentDietChanges = (recentChangesRes as any).data?.map((d: any) => ({
    id: d.id,
    residentName: `${d.residents?.first_name ?? ""} ${d.residents?.last_name ?? ""}`.trim() || "Unknown",
    changeType: d.diet_type ?? "Diet update",
    changedAt: d.updated_at,
  })) ?? [];

  // Aggregate diet type breakdown
  const dietCounts: Record<string, number> = {};
  for (const row of (breakdownRes as any).data ?? []) {
    const dt = row.diet_type ?? "Unspecified";
    dietCounts[dt] = (dietCounts[dt] || 0) + 1;
  }
  const specialDietBreakdown = Object.entries(dietCounts)
    .map(([dietType, count]) => ({ dietType, count }))
    .sort((a, b) => b.count - a.count);

  return {
    censusCount: (censusRes as any).count ?? 0,
    specialDiets: (specialDietsRes as any).count ?? 0,
    mealsToday: (mealsRes as any).count ?? 0,
    dietChanges48h: (changesRes as any).count ?? 0,
    recentDietChanges,
    specialDietBreakdown,
  };
}
