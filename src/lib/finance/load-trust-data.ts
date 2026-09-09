import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { loadResidentMoneySnapshot } from "@/lib/finance/resident-money";
import type { Database } from "@/types/database";

export type ResidentTrustRow = {
  residentId: string; residentName: string; currentBalanceCents: number | null;
  legacyBalanceCents: number | null; legacyReviewRequired: boolean; ledgerMatchesBalance: boolean;
  facilityId: string; lastEntryDate: string | null; entriesCount: number;
};
export async function loadFinanceTrustData(supabase: SupabaseClient<Database>, organizationId: string, facilityId: string | null): Promise<ResidentTrustRow[]> {
  let residentQuery = supabase.from("residents").select("id, first_name, last_name", { count: "exact" })
    .eq("organization_id", organizationId).is("deleted_at", null).order("id");
  if (facilityId) residentQuery = residentQuery.eq("facility_id", facilityId);
  const [snapshot, residents] = await Promise.all([
    loadResidentMoneySnapshot(supabase, organizationId, facilityId),
    readAllPages((from, to) => residentQuery.range(from, to)),
  ]);
  if (residents.error) throw residents.error;
  const names = new Map((residents.data ?? []).map(row => [row.id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
  return snapshot.rows.map(row => ({ residentId: row.resident_id, residentName: names.get(row.resident_id) || "Resident record outside current chart scope",
    currentBalanceCents: row.balance_cents, legacyBalanceCents: row.legacy_balance_cents,
    legacyReviewRequired: row.legacy_review_required, ledgerMatchesBalance: row.ledger_matches_balance,
    facilityId: row.facility_id, lastEntryDate: row.last_entry_at ? formatInTimeZone(row.last_entry_at, "America/New_York", "MMM d, yyyy, h:mm a zzz") : null, entriesCount: row.ledger_entry_count }));
}
