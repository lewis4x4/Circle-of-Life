import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import {
  FACILITY_OPERATOR_TZ,
  facilityDateIsoDaysFromToday,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { UNSETTLED_INVOICE_STATUSES, summarizeReceivables } from "@/lib/billing/receivables";
import {
  EMPTY_PRESENCE_CENSUS,
  summarizePresenceCensus,
  type PresenceCensus,
} from "@/lib/executive/presence-census";
import {
  computeFacilityOccupancyPct,
  computeFacilityOccupiedResidents,
  computePortfolioOccupancyFromBedCensus,
  fetchFacilityBedCensusById,
  isFacilityOccupancyCensusLoaded,
} from "@/lib/executive/facility-occupancy-census";
import type { PortfolioOccupancyScope } from "@/lib/occupancy/portfolio-occupancy-display";
import { fetchExecRegisterCoverage, type ExecRegisterCoverage } from "@/lib/executive/register-coverage";
import { requireHeadCount } from "@/lib/metrics/head-count";

/** Versioned payload shape for `exec_kpi_snapshots.metrics` when persisted by cron (Module 24). */
export const EXEC_KPI_METRICS_VERSION = 1 as const;

export type ExecKpiPayload = {
  version: typeof EXEC_KPI_METRICS_VERSION;
  census: {
    occupiedResidents: number;
    licensedBeds: number;
    occupancyPct: number | null;
    /** When partial census is posted, scopes the portfolio headline to posted sites only. */
    occupancyScope?: PortfolioOccupancyScope;
    /**
     * In-house vs on-hold split of the occupied population (additive — the
     * denominator is unchanged and `presence.total === occupiedResidents`).
     * Optional so cron-persisted snapshots written before this field still
     * validate; the live fetch always populates it.
     */
    presence?: PresenceCensus;
  };
  /**
   * Receivables in the COL-650 sense: sent, partly paid and overdue invoices
   * with a balance, the same figure Billing's Outstanding AR shows. Drafts are
   * counted apart in `notYetSent*` (optional so snapshots persisted before
   * COL-667 still validate; those counted drafts inside the two totals).
   */
  financial: {
    openInvoicesCount: number;
    totalBalanceDueCents: number;
    notYetSentCount?: number;
    notYetSentCents?: number;
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
    /** `null` on live load — nightly resident-safety-scorer owns miss-rate aggregation. */
    missedRate: number | null;
    openExceptions: number;
    activeWatchCount: number;
  };
  /**
   * Whether the registers behind the counts were ever used in scope (COL-649).
   * Optional so cron-persisted snapshots written before this field validate.
   */
  registers?: ExecRegisterCoverage;
};

/** Quiet Operator gap copy when live loaders skip miss-rate aggregation. */
export const EXECUTIVE_LIVE_MISSED_RATE_NOT_COMPUTED_COPY = "Miss rate not on live load";

export function formatExecutiveLiveMissedRate(missedRate: number | null): string {
  if (missedRate === null) return EXECUTIVE_LIVE_MISSED_RATE_NOT_COMPUTED_COPY;
  return `${Math.round(missedRate * 100)}%`;
}

/** The invoice columns the executive AR figures read. */
export const EXECUTIVE_OPEN_INVOICE_COLUMNS = "facility_id, balance_due, status, due_date";

export type ExecutiveOpenInvoiceRow = {
  facility_id: string;
  balance_due: number | null;
  status: string;
  due_date: string | null;
};

/** Executive AR from open invoice rows, through the shared receivable definition (COL-667). */
export function summarizeExecutiveFinancial(
  rows: ReadonlyArray<ExecutiveOpenInvoiceRow>,
  asOfIso: string,
): ExecKpiPayload["financial"] {
  const summary = summarizeReceivables(
    rows.map((row) => ({ status: row.status, balanceDueCents: row.balance_due ?? 0, dueDateIso: row.due_date ?? asOfIso })),
    asOfIso,
  );
  return {
    openInvoicesCount: summary.receivableCount,
    totalBalanceDueCents: summary.receivableCents,
    notYetSentCount: summary.notYetSentCount,
    notYetSentCents: summary.notYetSentCents,
  };
}

/** Eastern calendar windows for operator-facing today, +30 cert expiry, and MTD medication errors. */
export function getExecutiveKpiDateWindow(now: Date = new Date()) {
  const today = todayFacilityDateIso(now);
  const plus30 = facilityDateIsoDaysFromToday(30, now);
  const mtdStart = `${formatInTimeZone(now, FACILITY_OPERATOR_TZ, "yyyy-MM")}-01`;
  return { today, plus30, mtdStart };
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
  const { today, plus30, mtdStart } = getExecutiveKpiDateWindow();

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
      census: { occupiedResidents: 0, licensedBeds: 0, occupancyPct: null, presence: EMPTY_PRESENCE_CENSUS },
      financial: { openInvoicesCount: 0, totalBalanceDueCents: 0, notYetSentCount: 0, notYetSentCents: 0 },
      clinical: { openIncidents: 0, medicationErrorsMtd: 0 },
      compliance: { openSurveyDeficiencies: 0 },
      workforce: { certificationsExpiring30d: 0 },
      infection: { activeOutbreaks: 0 },
      residentAssurance: {
        overdueTasksCount: 0,
        missedRate: null,
        openExceptions: 0,
        activeWatchCount: 0,
      },
    };
  }

  // Select status rows (not a head:true count) so we can derive the in-house
  // vs on-hold presence split from the same query — occupiedResidents is then
  // just presence.total, keeping occupancy a single number.
  let residentsQuery = supabase
    .from("residents")
    .select("status")
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"]);

  if (facilityScoped) {
    residentsQuery = residentsQuery.eq("facility_id", facilityId!);
  } else {
    residentsQuery = residentsQuery.in("facility_id", facilityIds);
  }

  let invoicesOpenQuery = supabase
    .from("invoices")
    .select(EXECUTIVE_OPEN_INVOICE_COLUMNS)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .is("voided_at", null)
    .in("status", [...UNSETTLED_INVOICE_STATUSES])
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

  // Smart Rounding queries
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
    residentsRes,
    invoicesOpenRes,
    incidentsOpenRes,
    medErrorsMtdRes,
    deficienciesOpenRes,
    certsExpiringRes,
    outbreaksActiveRes,
    overdueTasksRes,
    openExceptionsRes,
    activeWatchRes,
    bedCensusByFacility,
    registers,
  ] = await Promise.all([
    residentsQuery,
    invoicesOpenQuery,
    incidentsOpenQuery,
    medErrorsMtdQuery,
    deficienciesOpenQuery,
    certsExpiringQuery,
    outbreaksActiveQuery,
    overdueTasksQuery,
    openExceptionsQuery,
    activeWatchQuery,
    fetchFacilityBedCensusById(supabase, facilityIds),
    fetchExecRegisterCoverage(
      supabase,
      organizationId,
      facilityScoped ? { facilityId: facilityId! } : { facilityIds },
    ),
  ]);

  const batchErrors = [
    residentsRes.error,
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
  const presence = summarizePresenceCensus(residentsRes.data ?? []);
  const facility = facilityScoped ? facilities[0] : null;
  const facilityCensus = facility ? bedCensusByFacility.get(facility.id) : undefined;
  const occupancyLoaded = facility ? isFacilityOccupancyCensusLoaded(facility, facilityCensus) : true;

  let occupiedResidents: number;
  let occupancyPct: number | null;
  let occupancyScope: PortfolioOccupancyScope | undefined;
  let censusLicensedBeds = licensedBeds;

  if (facilityScoped && facility) {
    occupiedResidents = occupancyLoaded ? computeFacilityOccupiedResidents(facility, facilityCensus) : 0;
    occupancyPct = occupancyLoaded ? computeFacilityOccupancyPct(facility, facilityCensus) : null;
  } else {
    const portfolioOccupancy = computePortfolioOccupancyFromBedCensus(facilities, bedCensusByFacility);
    occupiedResidents = portfolioOccupancy.postedOccupiedSum;
    occupancyPct = portfolioOccupancy.occupancyPct;
    censusLicensedBeds = portfolioOccupancy.allFacilitiesPosted
      ? licensedBeds
      : portfolioOccupancy.postedDenominatorBeds;
    occupancyScope = {
      allFacilitiesPosted: portfolioOccupancy.allFacilitiesPosted,
      postedFacilityCount: portfolioOccupancy.postedFacilityCount,
      totalFacilityCount: portfolioOccupancy.totalFacilityCount,
    };
  }

  const financial = summarizeExecutiveFinancial(
    (invoicesOpenRes.data ?? []) as unknown as ExecutiveOpenInvoiceRow[],
    today,
  );

  return {
    version: EXEC_KPI_METRICS_VERSION,
    census: {
      occupiedResidents,
      licensedBeds: censusLicensedBeds,
      occupancyPct,
      occupancyScope,
      presence,
    },
    financial,
    clinical: {
      openIncidents: requireHeadCount(incidentsOpenRes, "Open incidents"),
      medicationErrorsMtd: requireHeadCount(medErrorsMtdRes, "Medication errors MTD"),
    },
    compliance: {
      openSurveyDeficiencies: requireHeadCount(deficienciesOpenRes, "Open survey deficiencies"),
    },
    workforce: {
      certificationsExpiring30d: requireHeadCount(certsExpiringRes, "Certifications expiring"),
    },
    infection: {
      activeOutbreaks: requireHeadCount(outbreaksActiveRes, "Active outbreaks"),
    },
    residentAssurance: {
      overdueTasksCount: requireHeadCount(overdueTasksRes, "Overdue tasks"),
      missedRate: null,
      openExceptions: requireHeadCount(openExceptionsRes, "Open exceptions"),
      activeWatchCount: requireHeadCount(activeWatchRes, "Active watches"),
    },
    registers,
  };
}
