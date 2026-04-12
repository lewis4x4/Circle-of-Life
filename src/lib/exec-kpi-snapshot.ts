import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

/** Versioned payload shape for `exec_kpi_snapshots.metrics` when persisted by cron (Module 24). */
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
  residentAssurance: {
    overdueTasksCount: number;
    missedRate: number;
    openExceptions: number;
    activeWatchCount: number;
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

/**
 * Live KPI aggregates for the Executive command center (reads source modules; does not require
 * `exec_kpi_snapshots` rows). Respects optional facility scope from the admin facility selector.
 */
export async function fetchExecutiveKpiSnapshot(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  facilityId: string | null,
): Promise<ExecKpiPayload> {
  const facilityScoped = isValidFacilityIdForQuery(facilityId);
  const { today, plus30 } = todayAndPlus30Iso();
  const mtdStart = startOfMonthIsoDate();

  let facilitiesQuery = supabase
    .from("facilities")
    .select("id, total_licensed_beds")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (facilityScoped) {
    facilitiesQuery = facilitiesQuery.eq("id", facilityId!);
  }

  const facilitiesRes = await facilitiesQuery;
  if (facilitiesRes.error) throw new Error(facilitiesRes.error.message);

  const facilities = facilitiesRes.data ?? [];
  const facilityIds = facilities.map((f) => f.id);
  if (facilityIds.length === 0) {
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

  let residentsCountQuery = supabase
    .from("residents")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"]);

  if (facilityScoped) {
    residentsCountQuery = residentsCountQuery.eq("facility_id", facilityId!);
  } else {
    residentsCountQuery = residentsCountQuery.in("facility_id", facilityIds);
  }

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

  // Resident Assurance queries
  let overdueTasksQuery = supabase
    .from("resident_observation_tasks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["overdue", "critically_overdue"]);

  let openExceptionsQuery = supabase
    .from("resident_observation_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .eq("follow_up_status", "open");

  let activeWatchQuery = supabase
    .from("resident_watch_instances")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .eq("status", "active");

  if (facilityScoped) {
    invoicesOpenQuery = invoicesOpenQuery.eq("facility_id", facilityId!);
    incidentsOpenQuery = incidentsOpenQuery.eq("facility_id", facilityId!);
    medErrorsMtdQuery = medErrorsMtdQuery.eq("facility_id", facilityId!);
    deficienciesOpenQuery = deficienciesOpenQuery.eq("facility_id", facilityId!);
    certsExpiringQuery = certsExpiringQuery.eq("facility_id", facilityId!);
    outbreaksActiveQuery = outbreaksActiveQuery.eq("facility_id", facilityId!);
    overdueTasksQuery = overdueTasksQuery.eq("facility_id", facilityId!);
    openExceptionsQuery = openExceptionsQuery.eq("facility_id", facilityId!);
    activeWatchQuery = activeWatchQuery.eq("facility_id", facilityId!);
  }

  const [
    residentsCountRes,
    invoicesOpenRes,
    incidentsOpenRes,
    medErrorsMtdRes,
    deficienciesOpenRes,
    certsExpiringRes,
    outbreaksActiveRes,
    overdueTasksRes,
    openExceptionsRes,
    activeWatchRes,
  ] = await Promise.all([
    residentsCountQuery,
    invoicesOpenQuery,
    incidentsOpenQuery,
    medErrorsMtdQuery,
    deficienciesOpenQuery,
    certsExpiringQuery,
    outbreaksActiveQuery,
    overdueTasksQuery,
    openExceptionsQuery,
    activeWatchQuery,
  ]);

  const batchErrors = [
    residentsCountRes.error,
    invoicesOpenRes.error,
    incidentsOpenRes.error,
    medErrorsMtdRes.error,
    deficienciesOpenRes.error,
    certsExpiringRes.error,
    outbreaksActiveRes.error,
    overdueTasksRes.error,
    openExceptionsRes.error,
    activeWatchRes.error,
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
  const totalBalanceDueCents = invoiceRows.reduce((sum, row) => sum + (row.balance_due ?? 0), 0);

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
    residentAssurance: {
      overdueTasksCount: overdueTasksRes.count ?? 0,
      missedRate: 0, // Computed by resident-safety-scorer; live calc too expensive here
      openExceptions: openExceptionsRes.count ?? 0,
      activeWatchCount: activeWatchRes.count ?? 0,
    },
  };
}
