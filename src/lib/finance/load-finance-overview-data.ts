import type { SupabaseClient } from "@supabase/supabase-js";

import { BILLED_INVOICE_STATUSES } from "@/lib/billing/receivables";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import type { Database } from "@/types/database";

export type FinanceOverviewSnapshot = {
  /** Null when the count read failed — never 0 (COL-649). */
  postedCount: number | null;
  /** Null when either the sent-invoice count or the posted-source read failed. */
  unpostedInvoices: number | null;
  /** Sent (billed) invoices in scope; null when the count read failed. */
  sentInvoices: number | null;
  postedLookbackStart: string;
};

export async function loadFinanceOverviewData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  now: Date = new Date(),
): Promise<FinanceOverviewSnapshot> {
  const [facilityYear, facilityMonth, facilityDay] = todayFacilityDateIso(now).split("-").map(Number);
  const start = new Date(Date.UTC(facilityYear, facilityMonth - 1, facilityDay));
  start.setUTCMonth(start.getUTCMonth() - 1);
  const iso = [
    start.getUTCFullYear(),
    String(start.getUTCMonth() + 1).padStart(2, "0"),
    String(start.getUTCDate()).padStart(2, "0"),
  ].join("-");

  const [
    { count: postedTotal, error: postedError },
    { count: invTotal, error: invError },
    { data: postedSources, error: postedSourcesError },
  ] = await Promise.all([
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
      .is("deleted_at" as never, null as never)
      // Drafts cannot be posted (migration 340) and are not billed, so they are not "unposted".
      .in("status" as never, [...BILLED_INVOICE_STATUSES] as never),
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
  const sentInvoices = !invError && typeof invTotal === "number" ? invTotal : null;

  return {
    postedCount: !postedError && typeof postedTotal === "number" ? postedTotal : null,
    unpostedInvoices: sentInvoices === null ? null : Math.max(0, sentInvoices - postedIds.size),
    sentInvoices,
    postedLookbackStart: iso,
  };
}
