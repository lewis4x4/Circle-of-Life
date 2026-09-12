import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { cents } from "@/lib/finance-integration/payload";

// PostgreSQL UUIDs include Haven's existing non-RFC seed identities.
const postgresUuid = z.string().regex(UUID_STRING_RE);
const rowSchema = z.object({
  resident_id: postgresUuid, facility_id: postgresUuid, account_id: postgresUuid.nullable(),
  balance_cents: z.number().int().nullable(), ledger_movement_cents: z.string(),
  legacy_balance_cents: z.number().int().nullable(), legacy_entry_count: z.number().int().nonnegative(),
  ledger_entry_count: z.number().int().nonnegative(), last_entry_at: z.string().nullable(),
  legacy_review_required: z.boolean(), ledger_matches_balance: z.boolean(),
});
export const residentMoneySchema = z.object({ as_of: z.string(), canonical_ledger: z.literal("resident_trust_transactions"), external_reconciliation: z.literal("NOT_VERIFIED"), rows: z.array(rowSchema) });
export type ResidentMoneySnapshot = z.infer<typeof residentMoneySchema>;
export async function loadResidentMoneySnapshot(supabase: SupabaseClient<Database>, organizationId: string, facilityId: string | null): Promise<ResidentMoneySnapshot> {
  const { data, error } = await supabase.rpc("resident_money_snapshot", { p_organization_id: organizationId, p_facility_id: facilityId });
  if (error) throw error;
  const snapshot = residentMoneySchema.parse(data);
  for (const row of snapshot.rows) cents(row.ledger_movement_cents);
  return snapshot;
}
