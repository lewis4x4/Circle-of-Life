import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type QualityMeasureRow = Database["public"]["Tables"]["quality_measures"]["Row"];
export type QualityLatestRow = Database["public"]["Views"]["quality_latest_facility_measures"]["Row"] & {
  quality_measures?: { name: string; measure_key: string } | null;
};
export type QualityPbjRow = Database["public"]["Tables"]["pbj_export_batches"]["Row"];

export type QualityHubSnapshot = {
  measures: QualityMeasureRow[];
  latest: QualityLatestRow[];
  pbjRows: QualityPbjRow[];
};

export async function fetchQualityHubSnapshot(
  facilityId: string,
  organizationId: string,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<QualityHubSnapshot> {
  const [mRes, viewRes, pbjRes] = await Promise.all([
    supabase
      .from("quality_measures")
      .select("*")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase.from("quality_latest_facility_measures").select("*").eq("facility_id", facilityId),
    supabase
      .from("pbj_export_batches")
      .select("*")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  if (mRes.error) throw mRes.error;
  if (viewRes.error) throw viewRes.error;
  if (pbjRes.error) throw pbjRes.error;

  const rawLatest = (viewRes.data ?? []) as QualityLatestRow[];
  const measureIds = [...new Set(rawLatest.map((r) => r.quality_measure_id).filter(Boolean))] as string[];
  const nameById: Record<string, { name: string; measure_key: string }> = {};

  if (measureIds.length > 0) {
    const { data: mNames, error: namesErr } = await supabase
      .from("quality_measures")
      .select("id, name, measure_key")
      .in("id", measureIds);
    if (namesErr) throw namesErr;
    for (const row of mNames ?? []) {
      nameById[row.id] = { name: row.name, measure_key: row.measure_key };
    }
  }

  return {
    measures: (mRes.data ?? []) as QualityMeasureRow[],
    latest: rawLatest.map((r) => ({
      ...r,
      quality_measures: r.quality_measure_id ? nameById[r.quality_measure_id] ?? null : null,
    })),
    pbjRows: (pbjRes.data ?? []) as QualityPbjRow[],
  };
}
