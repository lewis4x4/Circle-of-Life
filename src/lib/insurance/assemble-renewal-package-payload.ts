/**
 * Assembles JSON payload for `renewal_data_packages.payload` (Module 18 Enhanced).
 * Shared with admin UI; keep metrics additive and auditable.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export const RENEWAL_PACKAGE_PAYLOAD_VERSION = 1 as const;

export type RenewalPackagePayload = {
  version: typeof RENEWAL_PACKAGE_PAYLOAD_VERSION;
  period: { start: string; end: string };
  entity_id: string;
  metrics: {
    active_residents: number;
    incidents_in_period: number;
    active_staff: number;
    invoice_total_cents: number;
  };
  assembled_at: string;
};

export async function assembleRenewalPackagePayload(
  supabase: SupabaseClient<Database>,
  params: {
    organizationId: string;
    entityId: string;
    periodStart: string;
    periodEnd: string;
  },
): Promise<{ ok: true; payload: RenewalPackagePayload } | { ok: false; error: string }> {
  const { organizationId, entityId, periodStart, periodEnd } = params;

  const { data: facs, error: fErr } = await supabase
    .from("facilities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("entity_id", entityId)
    .is("deleted_at", null);
  if (fErr) return { ok: false, error: fErr.message };
  const facilityIds = (facs ?? []).map((f) => f.id);
  if (facilityIds.length === 0) {
    return {
      ok: true,
      payload: {
        version: RENEWAL_PACKAGE_PAYLOAD_VERSION,
        period: { start: periodStart, end: periodEnd },
        entity_id: entityId,
        metrics: {
          active_residents: 0,
          incidents_in_period: 0,
          active_staff: 0,
          invoice_total_cents: 0,
        },
        assembled_at: new Date().toISOString(),
      },
    };
  }

  const periodStartTs = `${periodStart}T00:00:00.000Z`;
  const periodEndTs = `${periodEnd}T23:59:59.999Z`;

  const [resC, incC, stfC, invRows] = await Promise.all([
    supabase
      .from("residents")
      .select("id", { count: "exact", head: true })
      .in("facility_id", facilityIds)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .is("deleted_at", null),
    supabase
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .in("facility_id", facilityIds)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .gte("occurred_at", periodStartTs)
      .lte("occurred_at", periodEndTs),
    supabase
      .from("staff")
      .select("id", { count: "exact", head: true })
      .in("facility_id", facilityIds)
      .eq("organization_id", organizationId)
      .eq("employment_status", "active")
      .is("deleted_at", null),
    supabase
      .from("invoices")
      .select("total")
      .eq("organization_id", organizationId)
      .eq("entity_id", entityId)
      .is("deleted_at", null)
      .lte("period_start", periodEnd)
      .gte("period_end", periodStart),
  ]);

  if (resC.error) return { ok: false, error: resC.error.message };
  if (incC.error) return { ok: false, error: incC.error.message };
  if (stfC.error) return { ok: false, error: stfC.error.message };
  if (invRows.error) return { ok: false, error: invRows.error.message };

  const invoiceTotal = (invRows.data ?? []).reduce((sum, row) => sum + row.total, 0);

  return {
    ok: true,
    payload: {
      version: RENEWAL_PACKAGE_PAYLOAD_VERSION,
      period: { start: periodStart, end: periodEnd },
      entity_id: entityId,
      metrics: {
        active_residents: resC.count ?? 0,
        incidents_in_period: incC.count ?? 0,
        active_staff: stfC.count ?? 0,
        invoice_total_cents: invoiceTotal,
      },
      assembled_at: new Date().toISOString(),
    },
  };
}
