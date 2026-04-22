import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { EXEC_KPI_METRICS_VERSION, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";

type FacilityMini = {
  id: string;
  total_licensed_beds: number | null;
};

type OpenInvoiceRow = {
  facility_id: string;
  balance_due: number;
};

type CountByFacilityRow = {
  facility_id: string;
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

function emptyKpi(): ExecKpiPayload {
  return {
    version: EXEC_KPI_METRICS_VERSION,
    census: { occupiedResidents: 0, licensedBeds: 0, occupancyPct: null },
    financial: { openInvoicesCount: 0, totalBalanceDueCents: 0 },
    clinical: { openIncidents: 0, medicationErrorsMtd: 0 },
    compliance: { openSurveyDeficiencies: 0 },
    workforce: { certificationsExpiring30d: 0 },
    infection: { activeOutbreaks: 0 },
    residentAssurance: { overdueTasksCount: 0, missedRate: 0, openExceptions: 0, activeWatchCount: 0 },
  };
}

function countRows(rows: CountByFacilityRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.facility_id, (counts.get(row.facility_id) ?? 0) + 1);
  }
  return counts;
}

export async function loadExecutiveKpiBulk(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  scopedFacilityId: string | null = null,
): Promise<{ orgKpi: ExecKpiPayload; facilityKpis: Map<string, ExecKpiPayload> }> {
  const { today, plus30 } = todayAndPlus30Iso();
  const mtdStart = startOfMonthIsoDate();
  const facilityScoped = isValidFacilityIdForQuery(scopedFacilityId);

  let facilitiesQuery = supabase
    .from("facilities")
    .select("id, total_licensed_beds")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (facilityScoped) {
    facilitiesQuery = facilitiesQuery.eq("id", scopedFacilityId!);
  }

  const facilitiesRes = await facilitiesQuery;
  if (facilitiesRes.error) throw new Error(facilitiesRes.error.message);

  const facilities = (facilitiesRes.data ?? []) as FacilityMini[];
  const facilityIds = facilities.map((facility) => facility.id);
  if (facilityIds.length === 0) {
    return { orgKpi: emptyKpi(), facilityKpis: new Map() };
  }

  const scope = <
    TQuery extends {
      eq: (column: string, value: string) => TQuery;
      in: (column: string, values: string[]) => TQuery;
    },
  >(query: TQuery): TQuery => {
    if (facilityScoped) return query.eq("facility_id", scopedFacilityId!);
    return query.in("facility_id", facilityIds);
  };

  const [
    residentsRes,
    invoicesRes,
    incidentsRes,
    medErrorsRes,
    deficienciesRes,
    certsRes,
    outbreaksRes,
    overdueTasksRes,
    openExceptionsRes,
    activeWatchRes,
  ] = await Promise.all([
    scope(
      supabase
        .from("residents")
        .select("facility_id")
        .is("deleted_at", null)
        .in("status", ["active", "hospital_hold", "loa"]),
    ),
    scope(
      supabase
        .from("invoices")
        .select("facility_id, balance_due")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .is("voided_at", null)
        .gt("balance_due", 0),
    ),
    scope(
      supabase
        .from("incidents")
        .select("facility_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .in("status", ["open", "investigating"]),
    ),
    scope(
      supabase
        .from("medication_errors")
        .select("facility_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .gte("occurred_at", mtdStart),
    ),
    scope(
      supabase
        .from("survey_deficiencies")
        .select("facility_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .in("status", ["open", "poc_submitted", "poc_accepted", "recited"]),
    ),
    scope(
      supabase
        .from("staff_certifications")
        .select("facility_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .eq("status", "active")
        .not("expiration_date", "is", null)
        .gte("expiration_date", today)
        .lte("expiration_date", plus30),
    ),
    scope(
      supabase
        .from("infection_outbreaks")
        .select("facility_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .is("resolved_at", null),
    ),
    scope(
      supabase
        .from("resident_observation_tasks")
        .select("facility_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .in("status", ["overdue", "critically_overdue"]),
    ),
    scope(
      supabase
        .from("resident_observation_exceptions")
        .select("facility_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .eq("follow_up_status", "open"),
    ),
    scope(
      supabase
        .from("resident_watch_instances")
        .select("facility_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .eq("status", "active"),
    ),
  ]);

  const batchErrors = [
    residentsRes.error,
    invoicesRes.error,
    incidentsRes.error,
    medErrorsRes.error,
    deficienciesRes.error,
    certsRes.error,
    outbreaksRes.error,
    overdueTasksRes.error,
    openExceptionsRes.error,
    activeWatchRes.error,
  ].filter((error): error is NonNullable<typeof error> => error != null);

  if (batchErrors.length > 0) {
    throw new Error(batchErrors[0].message);
  }

  const residentsByFacility = countRows((residentsRes.data ?? []) as CountByFacilityRow[]);
  const incidentsByFacility = countRows((incidentsRes.data ?? []) as CountByFacilityRow[]);
  const medErrorsByFacility = countRows((medErrorsRes.data ?? []) as CountByFacilityRow[]);
  const deficienciesByFacility = countRows((deficienciesRes.data ?? []) as CountByFacilityRow[]);
  const certsByFacility = countRows((certsRes.data ?? []) as CountByFacilityRow[]);
  const outbreaksByFacility = countRows((outbreaksRes.data ?? []) as CountByFacilityRow[]);
  const overdueTasksByFacility = countRows((overdueTasksRes.data ?? []) as CountByFacilityRow[]);
  const openExceptionsByFacility = countRows((openExceptionsRes.data ?? []) as CountByFacilityRow[]);
  const activeWatchByFacility = countRows((activeWatchRes.data ?? []) as CountByFacilityRow[]);

  const invoiceRows = (invoicesRes.data ?? []) as OpenInvoiceRow[];
  const invoiceCountByFacility = new Map<string, number>();
  const balanceByFacility = new Map<string, number>();
  for (const row of invoiceRows) {
    invoiceCountByFacility.set(row.facility_id, (invoiceCountByFacility.get(row.facility_id) ?? 0) + 1);
    balanceByFacility.set(row.facility_id, (balanceByFacility.get(row.facility_id) ?? 0) + (row.balance_due ?? 0));
  }

  const facilityKpis = new Map<string, ExecKpiPayload>();
  for (const facility of facilities) {
    const occupiedResidents = residentsByFacility.get(facility.id) ?? 0;
    const licensedBeds = facility.total_licensed_beds ?? 0;
    const occupancyPct = licensedBeds > 0 ? Math.round((occupiedResidents / licensedBeds) * 1000) / 10 : null;

    facilityKpis.set(facility.id, {
      version: EXEC_KPI_METRICS_VERSION,
      census: {
        occupiedResidents,
        licensedBeds,
        occupancyPct,
      },
      financial: {
        openInvoicesCount: invoiceCountByFacility.get(facility.id) ?? 0,
        totalBalanceDueCents: balanceByFacility.get(facility.id) ?? 0,
      },
      clinical: {
        openIncidents: incidentsByFacility.get(facility.id) ?? 0,
        medicationErrorsMtd: medErrorsByFacility.get(facility.id) ?? 0,
      },
      compliance: {
        openSurveyDeficiencies: deficienciesByFacility.get(facility.id) ?? 0,
      },
      workforce: {
        certificationsExpiring30d: certsByFacility.get(facility.id) ?? 0,
      },
      infection: {
        activeOutbreaks: outbreaksByFacility.get(facility.id) ?? 0,
      },
      residentAssurance: {
        overdueTasksCount: overdueTasksByFacility.get(facility.id) ?? 0,
        missedRate: 0,
        openExceptions: openExceptionsByFacility.get(facility.id) ?? 0,
        activeWatchCount: activeWatchByFacility.get(facility.id) ?? 0,
      },
    });
  }

  const orgKpi = emptyKpi();
  orgKpi.census.licensedBeds = facilities.reduce((sum, facility) => sum + (facility.total_licensed_beds ?? 0), 0);
  orgKpi.census.occupiedResidents = Array.from(facilityKpis.values()).reduce(
    (sum, kpi) => sum + kpi.census.occupiedResidents,
    0,
  );
  orgKpi.census.occupancyPct =
    orgKpi.census.licensedBeds > 0
      ? Math.round((orgKpi.census.occupiedResidents / orgKpi.census.licensedBeds) * 1000) / 10
      : null;
  orgKpi.financial.openInvoicesCount = invoiceRows.length;
  orgKpi.financial.totalBalanceDueCents = invoiceRows.reduce((sum, row) => sum + (row.balance_due ?? 0), 0);
  orgKpi.clinical.openIncidents = (incidentsRes.data ?? []).length;
  orgKpi.clinical.medicationErrorsMtd = (medErrorsRes.data ?? []).length;
  orgKpi.compliance.openSurveyDeficiencies = (deficienciesRes.data ?? []).length;
  orgKpi.workforce.certificationsExpiring30d = (certsRes.data ?? []).length;
  orgKpi.infection.activeOutbreaks = (outbreaksRes.data ?? []).length;
  orgKpi.residentAssurance.overdueTasksCount = (overdueTasksRes.data ?? []).length;
  orgKpi.residentAssurance.openExceptions = (openExceptionsRes.data ?? []).length;
  orgKpi.residentAssurance.activeWatchCount = (activeWatchRes.data ?? []).length;

  return {
    orgKpi,
    facilityKpis,
  };
}
