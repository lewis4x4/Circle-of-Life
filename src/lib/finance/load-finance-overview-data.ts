import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type FinanceOverviewSnapshot = {
  postedCount: number;
  unpostedInvoices: number;
};

export async function loadFinanceOverviewData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<FinanceOverviewSnapshot> {
  const start = new Date();
  start.setMonth(start.getMonth() - 1);
  const iso = start.toISOString().slice(0, 10);

  const [{ count }, { count: invTotal }, { data: postedSources, error: postedSourcesError }] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .gte("entry_date", iso)
      .is("deleted_at", null),
    supabase
      .from("invoices" as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id" as never, organizationId as never)
      .is("deleted_at" as never, null as never),
    supabase
      .from("journal_entries")
      .select("source_id")
      .eq("organization_id", organizationId)
      .eq("source_type", "invoice")
      .is("deleted_at", null),
  ]);

  if (postedSourcesError) {
    throw new Error(postedSourcesError.message);
  }

  const postedIds = new Set(
    (postedSources ?? []).map((row) => (row as { source_id: string | null }).source_id),
  );

  return {
    postedCount: count ?? 0,
    unpostedInvoices: Math.max(0, (invTotal ?? 0) - postedIds.size),
  };
}
