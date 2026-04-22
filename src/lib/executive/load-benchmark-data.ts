import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type CohortRow = Database["public"]["Tables"]["benchmark_cohorts"]["Row"];

export type CrossOperatorBenchmarkSettingRow = {
  id: string;
  enabled: boolean;
  status: "requested" | "approved" | "declined";
  requested_at: string;
  approved_at: string | null;
  terms_acknowledged_at: string | null;
  notes: string | null;
};

export type ExecutiveBenchmarksData = {
  rows: CohortRow[];
  facilities: { id: string; name: string }[];
  crossOperatorSetting: CrossOperatorBenchmarkSettingRow | null;
};

export async function loadExecutiveBenchmarkData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<ExecutiveBenchmarksData> {
  const [{ data: facs, error: fErr }, { data: cohorts, error: cErr }, crossOperatorResult] =
    await Promise.all([
      supabase
        .from("facilities")
        .select("id, name")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("benchmark_cohorts")
        .select("*")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("cross_operator_benchmark_settings" as never)
        .select("id, enabled, status, requested_at, approved_at, terms_acknowledged_at, notes")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);

  if (fErr) throw new Error(fErr.message);
  if (cErr) throw new Error(cErr.message);
  if (crossOperatorResult.error) throw new Error(crossOperatorResult.error.message);

  return {
    rows: (cohorts ?? []) as CohortRow[],
    facilities: (facs ?? []).map((facility) => ({ id: facility.id, name: facility.name })),
    crossOperatorSetting: (crossOperatorResult.data ?? null) as CrossOperatorBenchmarkSettingRow | null,
  };
}
