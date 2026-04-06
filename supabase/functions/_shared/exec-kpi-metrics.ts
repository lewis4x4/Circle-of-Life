/**
 * Mirrors `src/lib/exec-kpi-snapshot.ts` for Edge (Deno). Same aggregates; keep in sync when KPI domains change.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const EXEC_KPI_METRICS_VERSION = 1 as const;

export type ExecKpiPayload = {
  version: typeof EXEC_KPI_METRICS_VERSION;
  census: {
    occupiedResidents: number;
    licensedBeds: number;
    occupancyPct: number | null;
  };
  financial: {
    openInvoicesCount: number;
    totalBalanceDueCents: number;
  };
  clinical: {
    openIncidents: number;
    medicationErrorsMtd: number;
  };
  compliance: {
    openSurveyDeficiencies: number;
  };
  workforce: {
    certificationsExpiring30d: number;
  };
  infection: {
    activeOutbreaks: number;
  };
};

function startOfMonthIsoDate(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function todayAndPlus30Iso(): { today: string; plus30: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const p = new Date(now);
  p.setUTCDate(p.getUTCDate() + 30);
  return { today, plus30: p.toISOString().slice(0, 10) };
}

function emptyPayload(): ExecKpiPayload {
  return {
    version: EXEC_KPI_METRICS_VERSION,
    census: { occupiedResidents: 0, licensedBeds: 0, occupancyPct: null },
    financial: { openInvoicesCount: 0, totalBalanceDueCents: 0 },
    clinical: { openIncidents: 0, medicationErrorsMtd: 0 },
    compliance: { openSurveyDeficiencies: 0 },
    workforce: { certificationsExpiring30d: 0 },
    infection: { activeOutbreaks: 0 },
  };
}

/**
 * @param facilityIds — facilities to include (org-wide, entity, or single facility). Empty → zeros.
 */
export async function computeKpiForFacilityIds(
  supabase: SupabaseClient,
  organizationId: string,
  facilities: { id: string; total_licensed_beds: number | null }[],
): Promise<ExecKpiPayload> {
  const facilityIds = facilities.map((f) => f.id);
  if (facilityIds.length === 0) {
    return emptyPayload();
  }

  const single = facilityIds.length === 1;
  const facilityId = single ? facilityIds[0]! : null;

  const { today, plus30 } = todayAndPlus30Iso();
  const mtdStart = startOfMonthIsoDate();

  let residentsCountQuery = supabase
    .from("residents")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"]);

  let invoicesOpenQuery = supabase
    .from("invoices")
    .select("id, balance_due")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .is("voided_at", null)
    .gt("balance_due", 0);

  let incidentsOpenQuery = supabase
    .from("incidents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["open", "investigating"]);

  let medErrorsMtdQuery = supabase
    .from("medication_errors")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("occurred_at", mtdStart);

  let deficienciesOpenQuery = supabase
    .from("survey_deficiencies")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["open", "poc_submitted", "poc_accepted", "recited"]);

  let certsExpiringQuery = supabase
    .from("staff_certifications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .eq("status", "active")
    .not("expiration_date", "is", null)
    .gte("expiration_date", today)
    .lte("expiration_date", plus30);

  let outbreaksActiveQuery = supabase
    .from("infection_outbreaks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .is("resolved_at", null);

  if (single) {
    residentsCountQuery = residentsCountQuery.eq("facility_id", facilityId!);
    invoicesOpenQuery = invoicesOpenQuery.eq("facility_id", facilityId!);
    incidentsOpenQuery = incidentsOpenQuery.eq("facility_id", facilityId!);
    medErrorsMtdQuery = medErrorsMtdQuery.eq("facility_id", facilityId!);
    deficienciesOpenQuery = deficienciesOpenQuery.eq("facility_id", facilityId!);
    certsExpiringQuery = certsExpiringQuery.eq("facility_id", facilityId!);
    outbreaksActiveQuery = outbreaksActiveQuery.eq("facility_id", facilityId!);
  } else {
    residentsCountQuery = residentsCountQuery.in("facility_id", facilityIds);
    invoicesOpenQuery = invoicesOpenQuery.in("facility_id", facilityIds);
    incidentsOpenQuery = incidentsOpenQuery.in("facility_id", facilityIds);
    medErrorsMtdQuery = medErrorsMtdQuery.in("facility_id", facilityIds);
    deficienciesOpenQuery = deficienciesOpenQuery.in("facility_id", facilityIds);
    certsExpiringQuery = certsExpiringQuery.in("facility_id", facilityIds);
    outbreaksActiveQuery = outbreaksActiveQuery.in("facility_id", facilityIds);
  }

  const [
    residentsCountRes,
    invoicesOpenRes,
    incidentsOpenRes,
    medErrorsMtdRes,
    deficienciesOpenRes,
    certsExpiringRes,
    outbreaksActiveRes,
  ] = await Promise.all([
    residentsCountQuery,
    invoicesOpenQuery,
    incidentsOpenQuery,
    medErrorsMtdQuery,
    deficienciesOpenQuery,
    certsExpiringQuery,
    outbreaksActiveQuery,
  ]);

  const batchErrors = [
    residentsCountRes.error,
    invoicesOpenRes.error,
    incidentsOpenRes.error,
    medErrorsMtdRes.error,
    deficienciesOpenRes.error,
    certsExpiringRes.error,
    outbreaksActiveRes.error,
  ].filter((e): e is NonNullable<typeof e> => e != null);
  if (batchErrors.length > 0) {
    throw new Error(batchErrors[0].message);
  }

  const licensedBeds = facilities.reduce((sum, f) => sum + (f.total_licensed_beds ?? 0), 0);
  const occupiedResidents = residentsCountRes.count ?? 0;
  const occupancyPct =
    licensedBeds > 0 ? Math.round((occupiedResidents / licensedBeds) * 1000) / 10 : null;

  const invoiceRows = invoicesOpenRes.data ?? [];
  const openInvoicesCount = invoiceRows.length;
  const totalBalanceDueCents = invoiceRows.reduce(
    (sum, row: { balance_due?: number }) => sum + (row.balance_due ?? 0),
    0,
  );

  return {
    version: EXEC_KPI_METRICS_VERSION,
    census: {
      occupiedResidents,
      licensedBeds,
      occupancyPct,
    },
    financial: {
      openInvoicesCount,
      totalBalanceDueCents,
    },
    clinical: {
      openIncidents: incidentsOpenRes.count ?? 0,
      medicationErrorsMtd: medErrorsMtdRes.count ?? 0,
    },
    compliance: {
      openSurveyDeficiencies: deficienciesOpenRes.count ?? 0,
    },
    workforce: {
      certificationsExpiring30d: certsExpiringRes.count ?? 0,
    },
    infection: {
      activeOutbreaks: outbreaksActiveRes.count ?? 0,
    },
  };
}

export async function loadFacilitiesForOrganization(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ id: string; total_licensed_beds: number | null; entity_id: string }[]> {
  const { data, error } = await supabase
    .from("facilities")
    .select("id, total_licensed_beds, entity_id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; total_licensed_beds: number | null; entity_id: string }[];
}

export async function loadEntitiesForOrganization(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ id: string }[]> {
  const { data, error } = await supabase
    .from("entities")
    .select("id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string }[];
}
