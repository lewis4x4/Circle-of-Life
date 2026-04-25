import { createClient } from "@/lib/supabase/server";

import {
  getV2DashboardPayload,
  type V2DashboardId,
  type V2DashboardPayload,
} from "./v2-dashboards";

export type V2DashboardScopeOption = { id: string; label: string };

export type V2DashboardLoad = {
  payload: V2DashboardPayload;
  facilities: V2DashboardScopeOption[];
  generatedAt: string;
};

type FacilityRow = { id: string; name: string };
type FacilitiesResult = { data: FacilityRow[] | null; error: { message: string } | null };

/**
 * Server-side dashboard loader. Pulls the T1 payload from
 * `getV2DashboardPayload` (S8 fixtures; backed by Supabase views in the
 * follow-up) and the user-accessible facility list under RLS so the
 * ScopeSelector has real options.
 */
export async function loadV2Dashboard(
  id: V2DashboardId,
): Promise<V2DashboardLoad | null> {
  const payload = getV2DashboardPayload(id);
  if (!payload) return null;

  const supabase = await createClient();
  const result = (await supabase
    .from("facilities" as never)
    .select("id, name")
    .is("deleted_at", null)
    .order("name", { ascending: true })) as unknown as FacilitiesResult;

  const facilities: V2DashboardScopeOption[] = (result.data ?? []).map((row) => ({
    id: row.id,
    label: (row.name ?? "").trim() || "Unnamed facility",
  }));

  return {
    payload,
    facilities,
    generatedAt: payload.generatedAt,
  };
}
