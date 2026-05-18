/**
 * Mirrors `src/lib/exec-kpi-snapshot.ts` for Edge (Deno). Same aggregates; keep in sync when KPI domains change.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const EXEC_KPI_METRICS_VERSION = 1 as const;

export type ExecDashboardMetricCode =
  | "occ_pt"
  | "rev_mtd"
  | "labor_pct"
  | "inc_rate"
  | "survey_rd";
export type ExecDashboardStatusColor = "green" | "yellow" | "red";

export type ExecDashboardMetric = {
  code: ExecDashboardMetricCode;
  value: number;
  statusColor: ExecDashboardStatusColor;
};

export type ExecKpiPayload = {
  version: typeof EXEC_KPI_METRICS_VERSION;
  census: {
    occupiedResidents: number;
    licensedBeds: number;
    /** Legacy JSON value consumed by existing v1 pages: whole percent, e.g. 89.1. */
    occupancyPct: number | null;
    /** Normalized dashboard value for exec_metric_snapshots: decimal, e.g. 0.891. */
    occupancyRate: number | null;
  };
  financial: {
    openInvoicesCount: number;
    totalBalanceDueCents: number;
    billedRevenueMtdCents: number;
  };
  clinical: {
    openIncidents: number;
    medicationErrorsMtd: number;
    incidentRatePer1kResidentDays: number | null;
  };
  compliance: {
    openSurveyDeficiencies: number;
    surveyReadinessRate: number | null;
  };
  workforce: {
    certificationsExpiring30d: number;
    laborCostMtdCents: number | null;
    laborCostPct: number | null;
  };
  infection: {
    activeOutbreaks: number;
  };
  dashboardMetrics: ExecDashboardMetric[];
};

type StaffRateRow = {
  hourly_rate?: number | null;
  overtime_rate?: number | null;
};

type TimeRecordRow = {
  actual_hours?: number | null;
  regular_hours?: number | null;
  overtime_hours?: number | null;
  staff?: StaffRateRow | StaffRateRow[] | null;
};

type RiskSnapshotRow = {
  facility_id?: string | null;
  summary_json?: unknown;
};

function utcTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDateUtc(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
}

function addDaysIsoDate(isoDate: string, days: number): string {
  const d = parseIsoDateUtc(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfMonthIsoDate(asOfDate = utcTodayDate()): string {
  const d = parseIsoDateUtc(asOfDate);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString().slice(0, 10);
}

function todayAndPlus30Iso(
  asOfDate = utcTodayDate(),
): { today: string; plus30: string } {
  return { today: asOfDate, plus30: addDaysIsoDate(asOfDate, 30) };
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function statusHigherIsBetter(
  value: number,
  greenAt: number,
  yellowAt: number,
): ExecDashboardStatusColor {
  if (value >= greenAt) return "green";
  if (value >= yellowAt) return "yellow";
  return "red";
}

function statusLowerIsBetter(
  value: number,
  greenAt: number,
  yellowAt: number,
): ExecDashboardStatusColor {
  if (value <= greenAt) return "green";
  if (value <= yellowAt) return "yellow";
  return "red";
}

function firstJoinedRow<T>(rowOrRows: T | T[] | null | undefined): T | null {
  if (!rowOrRows) return null;
  return Array.isArray(rowOrRows) ? (rowOrRows[0] ?? null) : rowOrRows;
}

function computeLaborCostCents(rows: TimeRecordRow[]): number | null {
  let total = 0;
  let rowsWithCost = 0;

  for (const row of rows) {
    const staff = firstJoinedRow(row.staff);
    const regularRate = staff?.hourly_rate;
    if (
      typeof regularRate !== "number" || !Number.isFinite(regularRate) ||
      regularRate < 0
    ) {
      continue;
    }

    const actualHours =
      typeof row.actual_hours === "number" && Number.isFinite(row.actual_hours)
        ? row.actual_hours
        : null;
    const explicitRegularHours = typeof row.regular_hours === "number" &&
        Number.isFinite(row.regular_hours)
      ? row.regular_hours
      : null;
    const explicitOvertimeHours = typeof row.overtime_hours === "number" &&
        Number.isFinite(row.overtime_hours)
      ? row.overtime_hours
      : null;

    const overtimeHours = Math.max(0, explicitOvertimeHours ?? 0);
    const regularHours = Math.max(
      0,
      explicitRegularHours ?? Math.max(0, (actualHours ?? 0) - overtimeHours),
    );
    const overtimeRate = typeof staff?.overtime_rate === "number" &&
        Number.isFinite(staff.overtime_rate)
      ? staff.overtime_rate
      : Math.round(regularRate * 1.5);

    total += Math.round(
      regularHours * regularRate + overtimeHours * overtimeRate,
    );
    rowsWithCost += 1;
  }

  return rowsWithCost > 0 ? total : null;
}

function surveyReadinessFromSummary(summaryJson: unknown): number | null {
  if (!summaryJson || typeof summaryJson !== "object") return null;
  const raw = (summaryJson as Record<string, unknown>).survey_readiness_pct;
  const numeric = typeof raw === "number"
    ? raw
    : typeof raw === "string"
    ? Number(raw)
    : NaN;
  if (!Number.isFinite(numeric)) return null;
  return roundTo(clamp01(numeric > 1 ? numeric / 100 : numeric), 4);
}

function latestSurveyReadinessRate(rows: RiskSnapshotRow[]): number | null {
  const valuesByFacility = new Map<string, number>();

  for (const row of rows) {
    const facilityId = row.facility_id;
    if (!facilityId || valuesByFacility.has(facilityId)) continue;
    const value = surveyReadinessFromSummary(row.summary_json);
    if (value != null) valuesByFacility.set(facilityId, value);
  }

  const values = [...valuesByFacility.values()];
  if (values.length === 0) return null;
  return roundTo(
    values.reduce((sum, value) => sum + value, 0) / values.length,
    4,
  );
}

function buildDashboardMetrics(input: {
  occupancyRate: number | null;
  billedRevenueMtdCents: number;
  laborCostPct: number | null;
  incidentRatePer1kResidentDays: number | null;
  surveyReadinessRate: number | null;
}): ExecDashboardMetric[] {
  const metrics: ExecDashboardMetric[] = [];

  if (input.occupancyRate != null) {
    metrics.push({
      code: "occ_pt",
      value: input.occupancyRate,
      statusColor: statusHigherIsBetter(input.occupancyRate, 0.9, 0.85),
    });
  }

  metrics.push({
    code: "rev_mtd",
    value: input.billedRevenueMtdCents,
    statusColor: "green",
  });

  if (input.laborCostPct != null) {
    metrics.push({
      code: "labor_pct",
      value: input.laborCostPct,
      statusColor: statusLowerIsBetter(input.laborCostPct, 0.5, 0.55),
    });
  }

  if (input.incidentRatePer1kResidentDays != null) {
    metrics.push({
      code: "inc_rate",
      value: input.incidentRatePer1kResidentDays,
      statusColor: statusLowerIsBetter(
        input.incidentRatePer1kResidentDays,
        2,
        4,
      ),
    });
  }

  if (input.surveyReadinessRate != null) {
    metrics.push({
      code: "survey_rd",
      value: input.surveyReadinessRate,
      statusColor: statusHigherIsBetter(input.surveyReadinessRate, 0.95, 0.88),
    });
  }

  return metrics;
}

function emptyPayload(): ExecKpiPayload {
  return {
    version: EXEC_KPI_METRICS_VERSION,
    census: {
      occupiedResidents: 0,
      licensedBeds: 0,
      occupancyPct: null,
      occupancyRate: null,
    },
    financial: {
      openInvoicesCount: 0,
      totalBalanceDueCents: 0,
      billedRevenueMtdCents: 0,
    },
    clinical: {
      openIncidents: 0,
      medicationErrorsMtd: 0,
      incidentRatePer1kResidentDays: null,
    },
    compliance: { openSurveyDeficiencies: 0, surveyReadinessRate: null },
    workforce: {
      certificationsExpiring30d: 0,
      laborCostMtdCents: null,
      laborCostPct: null,
    },
    infection: { activeOutbreaks: 0 },
    dashboardMetrics: [],
  };
}

/**
 * @param facilityIds — facilities to include (org-wide, entity, or single facility). Empty → zeros.
 */
export async function computeKpiForFacilityIds(
  supabase: SupabaseClient,
  organizationId: string,
  facilities: { id: string; total_licensed_beds: number | null }[],
  options: { snapshotDate?: string } = {},
): Promise<ExecKpiPayload> {
  const facilityIds = facilities.map((f) => f.id);
  if (facilityIds.length === 0) {
    return emptyPayload();
  }

  const single = facilityIds.length === 1;
  const facilityId = single ? facilityIds[0]! : null;

  const snapshotDate = options.snapshotDate ?? utcTodayDate();
  const { today, plus30 } = todayAndPlus30Iso(snapshotDate);
  const mtdStart = startOfMonthIsoDate(snapshotDate);
  const nextSnapshotDate = addDaysIsoDate(snapshotDate, 1);
  const trailing30Start = addDaysIsoDate(snapshotDate, -29);

  let residentsCountQuery = supabase
    .from("residents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"]);

  let invoicesOpenQuery = supabase
    .from("invoices")
    .select("id, balance_due")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .is("voided_at", null)
    .gt("balance_due", 0);

  let invoicesMtdQuery = supabase
    .from("invoices")
    .select("id, total")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .is("voided_at", null)
    .gte("invoice_date", mtdStart)
    .lte("invoice_date", snapshotDate)
    .in("status", ["sent", "paid", "partial", "overdue"]);

  let incidentsOpenQuery = supabase
    .from("incidents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["open", "investigating"]);

  let incidentsTrailingRateQuery = supabase
    .from("incidents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("occurred_at", `${trailing30Start}T00:00:00.000Z`)
    .lt("occurred_at", `${nextSnapshotDate}T00:00:00.000Z`);

  let medErrorsMtdQuery = supabase
    .from("medication_errors")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("occurred_at", `${mtdStart}T00:00:00.000Z`)
    .lt("occurred_at", `${nextSnapshotDate}T00:00:00.000Z`);

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

  let timeRecordsMtdQuery = supabase
    .from("time_records")
    .select(
      "actual_hours, regular_hours, overtime_hours, staff:staff_id(hourly_rate, overtime_rate)",
    )
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .not("clock_out", "is", null)
    .gte("clock_in", `${mtdStart}T00:00:00.000Z`)
    .lt("clock_in", `${nextSnapshotDate}T00:00:00.000Z`);

  let surveyReadinessQuery = supabase
    .from("risk_score_snapshots")
    .select("facility_id, summary_json, computed_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("computed_at", { ascending: false })
    .limit(Math.max(10, facilityIds.length * 10));

  if (single) {
    residentsCountQuery = residentsCountQuery.eq("facility_id", facilityId!);
    invoicesOpenQuery = invoicesOpenQuery.eq("facility_id", facilityId!);
    invoicesMtdQuery = invoicesMtdQuery.eq("facility_id", facilityId!);
    incidentsOpenQuery = incidentsOpenQuery.eq("facility_id", facilityId!);
    incidentsTrailingRateQuery = incidentsTrailingRateQuery.eq(
      "facility_id",
      facilityId!,
    );
    medErrorsMtdQuery = medErrorsMtdQuery.eq("facility_id", facilityId!);
    deficienciesOpenQuery = deficienciesOpenQuery.eq(
      "facility_id",
      facilityId!,
    );
    certsExpiringQuery = certsExpiringQuery.eq("facility_id", facilityId!);
    outbreaksActiveQuery = outbreaksActiveQuery.eq("facility_id", facilityId!);
    timeRecordsMtdQuery = timeRecordsMtdQuery.eq("facility_id", facilityId!);
    surveyReadinessQuery = surveyReadinessQuery.eq("facility_id", facilityId!);
  } else {
    residentsCountQuery = residentsCountQuery.in("facility_id", facilityIds);
    invoicesOpenQuery = invoicesOpenQuery.in("facility_id", facilityIds);
    invoicesMtdQuery = invoicesMtdQuery.in("facility_id", facilityIds);
    incidentsOpenQuery = incidentsOpenQuery.in("facility_id", facilityIds);
    incidentsTrailingRateQuery = incidentsTrailingRateQuery.in(
      "facility_id",
      facilityIds,
    );
    medErrorsMtdQuery = medErrorsMtdQuery.in("facility_id", facilityIds);
    deficienciesOpenQuery = deficienciesOpenQuery.in(
      "facility_id",
      facilityIds,
    );
    certsExpiringQuery = certsExpiringQuery.in("facility_id", facilityIds);
    outbreaksActiveQuery = outbreaksActiveQuery.in("facility_id", facilityIds);
    timeRecordsMtdQuery = timeRecordsMtdQuery.in("facility_id", facilityIds);
    surveyReadinessQuery = surveyReadinessQuery.in("facility_id", facilityIds);
  }

  const [
    residentsCountRes,
    invoicesOpenRes,
    invoicesMtdRes,
    incidentsOpenRes,
    incidentsTrailingRateRes,
    medErrorsMtdRes,
    deficienciesOpenRes,
    certsExpiringRes,
    outbreaksActiveRes,
    timeRecordsMtdRes,
    surveyReadinessRes,
  ] = await Promise.all([
    residentsCountQuery,
    invoicesOpenQuery,
    invoicesMtdQuery,
    incidentsOpenQuery,
    incidentsTrailingRateQuery,
    medErrorsMtdQuery,
    deficienciesOpenQuery,
    certsExpiringQuery,
    outbreaksActiveQuery,
    timeRecordsMtdQuery,
    surveyReadinessQuery,
  ]);

  const batchErrors = [
    residentsCountRes.error,
    invoicesOpenRes.error,
    invoicesMtdRes.error,
    incidentsOpenRes.error,
    incidentsTrailingRateRes.error,
    medErrorsMtdRes.error,
    deficienciesOpenRes.error,
    certsExpiringRes.error,
    outbreaksActiveRes.error,
    timeRecordsMtdRes.error,
  ].filter((e): e is NonNullable<typeof e> => e != null);
  if (batchErrors.length > 0) {
    throw new Error(batchErrors[0].message);
  }

  const licensedBeds = facilities.reduce(
    (sum, f) => sum + (f.total_licensed_beds ?? 0),
    0,
  );
  const occupiedResidents = residentsCountRes.count ?? 0;
  const occupancyRate = licensedBeds > 0
    ? roundTo(occupiedResidents / licensedBeds, 4)
    : null;
  const occupancyPct = occupancyRate != null
    ? roundTo(occupancyRate * 100, 1)
    : null;

  const invoiceRows = invoicesOpenRes.data ?? [];
  const openInvoicesCount = invoiceRows.length;
  const totalBalanceDueCents = invoiceRows.reduce(
    (sum, row: { balance_due?: number }) => sum + (row.balance_due ?? 0),
    0,
  );

  const invoiceMtdRows = invoicesMtdRes.data ?? [];
  const billedRevenueMtdCents = invoiceMtdRows.reduce(
    (sum, row: { total?: number }) => sum + (row.total ?? 0),
    0,
  );

  const laborCostMtdCents = computeLaborCostCents(
    (timeRecordsMtdRes.data ?? []) as TimeRecordRow[],
  );
  const laborCostPct = laborCostMtdCents != null && billedRevenueMtdCents > 0
    ? roundTo(laborCostMtdCents / billedRevenueMtdCents, 4)
    : null;

  const residentDays = occupiedResidents * 30;
  const incidentRatePer1kResidentDays = residentDays > 0
    ? roundTo(((incidentsTrailingRateRes.count ?? 0) / residentDays) * 1000, 2)
    : null;

  const surveyReadinessRate = surveyReadinessRes.error
    ? null
    : latestSurveyReadinessRate(
      (surveyReadinessRes.data ?? []) as RiskSnapshotRow[],
    );

  const dashboardMetrics = buildDashboardMetrics({
    occupancyRate,
    billedRevenueMtdCents,
    laborCostPct,
    incidentRatePer1kResidentDays,
    surveyReadinessRate,
  });

  return {
    version: EXEC_KPI_METRICS_VERSION,
    census: {
      occupiedResidents,
      licensedBeds,
      occupancyPct,
      occupancyRate,
    },
    financial: {
      openInvoicesCount,
      totalBalanceDueCents,
      billedRevenueMtdCents,
    },
    clinical: {
      openIncidents: incidentsOpenRes.count ?? 0,
      medicationErrorsMtd: medErrorsMtdRes.count ?? 0,
      incidentRatePer1kResidentDays,
    },
    compliance: {
      openSurveyDeficiencies: deficienciesOpenRes.count ?? 0,
      surveyReadinessRate,
    },
    workforce: {
      certificationsExpiring30d: certsExpiringRes.count ?? 0,
      laborCostMtdCents,
      laborCostPct,
    },
    infection: {
      activeOutbreaks: outbreaksActiveRes.count ?? 0,
    },
    dashboardMetrics,
  };
}

export async function loadFacilitiesForOrganization(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<
  { id: string; total_licensed_beds: number | null; entity_id: string }[]
> {
  const { data, error } = await supabase
    .from("facilities")
    .select("id, total_licensed_beds, entity_id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string;
    total_licensed_beds: number | null;
    entity_id: string;
  }[];
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
