/**
 * GL period close — block posting into closed fiscal months (Module 17 Enhanced, migration 048).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type PeriodCheckOk = { ok: true; glPeriodCloseId: string | null };
export type PeriodCheckFail = { ok: false; error: string };

/**
 * Returns whether the calendar month of `entryDate` is open for posting.
 * If no `gl_period_closes` row exists for that month, the period is treated as open (implicit).
 * If a row exists with status `closed`, posting is blocked.
 */
export async function checkPeriodOpenForPosting(
  supabase: SupabaseClient<Database>,
  params: { organizationId: string; entityId: string; entryDate: string },
): Promise<PeriodCheckOk | PeriodCheckFail> {
  const d = params.entryDate.slice(0, 10);
  const parts = d.split("-");
  if (parts.length < 2) return { ok: false, error: "Invalid entry date." };
  const periodYear = Number(parts[0]);
  const periodMonth = Number(parts[1]);
  if (!Number.isFinite(periodYear) || !Number.isFinite(periodMonth) || periodMonth < 1 || periodMonth > 12) {
    return { ok: false, error: "Invalid entry date." };
  }

  const { data, error } = await supabase
    .from("gl_period_closes")
    .select("id, status")
    .eq("organization_id", params.organizationId)
    .eq("entity_id", params.entityId)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, glPeriodCloseId: null };
  if (data.status === "closed") {
    return {
      ok: false,
      error: `Accounting period ${periodYear}-${String(periodMonth).padStart(2, "0")} is closed. Reopen it in Finance → Period close, or change the entry date.`,
    };
  }
  return { ok: true, glPeriodCloseId: data.id };
}
