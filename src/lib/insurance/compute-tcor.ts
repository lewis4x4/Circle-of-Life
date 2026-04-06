/**
 * Total cost of risk (TCoR) — Module 18 Enhanced.
 * Rolling window: stated policy premiums for policies in force during the window, plus
 * incurred-style losses (paid + open reserve) for claims whose loss date falls in the window.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type TcorSnapshot = {
  periodStart: string;
  periodEnd: string;
  /** Sum of policy premium_cents for policies overlapping the period (active/draft/pending_renewal excluded if expired). */
  premiumsCents: number;
  /** Sum of (paid_cents + reserve_cents) for claims in the loss window. */
  incurredLossesCents: number;
  /** premiums + incurred (simple TCoR proxy; not GAAP). */
  tcorCents: number;
  policyRows: number;
  claimRows: number;
};

function rolling12MonthBounds(): { periodStart: string; periodEnd: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 365);
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

function lossDateForClaim(row: { date_of_loss: string | null; reported_at: string | null }): string | null {
  return row.date_of_loss ?? (row.reported_at ? row.reported_at.slice(0, 10) : null);
}

/**
 * @param entityId - when null, all entities in the organization
 */
export async function computeTotalCostOfRisk(
  supabase: SupabaseClient<Database>,
  params: { organizationId: string; entityId: string | null },
): Promise<{ ok: true; snapshot: TcorSnapshot } | { ok: false; error: string }> {
  const { organizationId, entityId } = params;
  const { periodStart, periodEnd } = rolling12MonthBounds();

  let polQ = supabase
    .from("insurance_policies")
    .select("id, premium_cents, effective_date, expiration_date, status")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["active", "pending_renewal"])
    .lte("effective_date", periodEnd)
    .gte("expiration_date", periodStart);

  if (entityId) polQ = polQ.eq("entity_id", entityId);

  const { data: policies, error: pErr } = await polQ;
  if (pErr) return { ok: false, error: pErr.message };

  let premiumsCents = 0;
  for (const p of policies ?? []) {
    const pc = p.premium_cents;
    if (pc != null && pc > 0) premiumsCents += pc;
  }

  let clQ = supabase
    .from("insurance_claims")
    .select("id, date_of_loss, reported_at, paid_cents, reserve_cents, entity_id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (entityId) clQ = clQ.eq("entity_id", entityId);

  const { data: claims, error: cErr } = await clQ;
  if (cErr) return { ok: false, error: cErr.message };

  let incurredLossesCents = 0;
  let claimRows = 0;
  for (const c of claims ?? []) {
    const ld = lossDateForClaim(c);
    if (!ld || ld < periodStart || ld > periodEnd) continue;
    incurredLossesCents += c.paid_cents + c.reserve_cents;
    claimRows += 1;
  }

  const tcorCents = premiumsCents + incurredLossesCents;

  return {
    ok: true,
    snapshot: {
      periodStart,
      periodEnd,
      premiumsCents,
      incurredLossesCents,
      tcorCents,
      policyRows: (policies ?? []).length,
      claimRows,
    },
  };
}
