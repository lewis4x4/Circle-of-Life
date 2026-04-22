import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type PeriodRow = {
  id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_at: string | null;
  closed_by: string | null;
};

export type PeriodCloseSnapshot = {
  history: PeriodRow[];
  selectedPeriod: PeriodRow | null;
  implicitOpen: boolean;
};

export async function loadPeriodCloseData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  entityId: string,
  periodYear: number,
  periodMonth: number,
): Promise<PeriodCloseSnapshot> {
  const { data, error } = await supabase
    .from("gl_period_closes")
    .select("id, period_year, period_month, status, closed_at, closed_by")
    .eq("organization_id", organizationId)
    .eq("entity_id", entityId)
    .is("deleted_at", null)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
    .limit(36);

  if (error) {
    throw new Error(error.message);
  }

  const history = (data ?? []) as PeriodRow[];
  const selectedPeriod =
    history.find((row) => row.period_year === periodYear && row.period_month === periodMonth) ?? null;

  return {
    history,
    selectedPeriod,
    implicitOpen: !selectedPeriod,
  };
}
