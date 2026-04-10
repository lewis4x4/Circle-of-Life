import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchExecutiveKpiSnapshot } from "@/lib/exec-kpi-snapshot";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database, Json } from "@/types/database";

export type ReportSummaryRow = { metricKey: string; value: string | number | null };

export type ReportExecutionResult = {
  summary: ReportSummaryRow[];
  rows: Record<string, string | number | null>[];
  /** Shown in print footer and optionally in UI */
  footnotes?: string[];
};

type ExecuteParams = {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  facilityId: string | null;
  filters?: Json;
};

type Executor = (params: ExecuteParams) => Promise<ReportExecutionResult>;

function startOfYearIsoDate(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoNow(): string {
  return new Date().toISOString();
}

async function runExecutiveSnapshot(params: ExecuteParams): Promise<ReportExecutionResult> {
  const kpi = await fetchExecutiveKpiSnapshot(
    params.supabase,
    params.organizationId,
    params.facilityId,
  );

  const summary: ReportSummaryRow[] = [
    { metricKey: "occupiedResidents", value: kpi.census.occupiedResidents },
    { metricKey: "licensedBeds", value: kpi.census.licensedBeds },
    { metricKey: "occupancyPct", value: kpi.census.occupancyPct },
    { metricKey: "openInvoices", value: kpi.financial.openInvoicesCount },
    { metricKey: "balanceDueCents", value: kpi.financial.totalBalanceDueCents },
    { metricKey: "openIncidents", value: kpi.clinical.openIncidents },
    { metricKey: "medicationErrorsMtd", value: kpi.clinical.medicationErrorsMtd },
    { metricKey: "openSurveyDeficiencies", value: kpi.compliance.openSurveyDeficiencies },
    { metricKey: "certificationsExpiring30d", value: kpi.workforce.certificationsExpiring30d },
    { metricKey: "activeOutbreaks", value: kpi.infection.activeOutbreaks },
  ];

  return {
    summary,
    rows: summary.map((item) => ({ metric: item.metricKey, value: item.value })),
  };
}

async function runFacilityOperatingScorecard(params: ExecuteParams): Promise<ReportExecutionResult> {
  const base = await runExecutiveSnapshot(params);
  return {
    ...base,
    footnotes: [
      "Operating scorecard aggregates census, financial exposure, clinical signals, compliance, workforce, and infection posture for the selected scope.",
    ],
  };
}

async function runExecutiveWeeklyPack(params: ExecuteParams): Promise<ReportExecutionResult> {
  const base = await runExecutiveSnapshot(params);
  return {
    ...base,
    footnotes: [
      "Executive weekly pack: the KPIs below are intended for leadership review alongside unit-level drill-down in each module.",
    ],
  };
}

async function runArAgingSummary(params: ExecuteParams): Promise<ReportExecutionResult> {
  const { supabase, organizationId, facilityId } = params;
  const facilityScoped = isValidFacilityIdForQuery(facilityId);

  let q = supabase
    .from("invoices")
    .select("id, balance_due, due_date, facility_id, invoice_number, payer_name")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .is("voided_at", null)
    .gt("balance_due", 0);

  if (facilityScoped) q = q.eq("facility_id", facilityId!);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const invRows = data ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let notYetDue = 0;
  let bucket1To30Cents = 0;
  let bucket31To60Cents = 0;
  let bucket61To90Cents = 0;
  let bucketOver90Cents = 0;
  let total = 0;

  const detailRows: Record<string, string | number | null>[] = [];

  for (const inv of invRows) {
    const bal = inv.balance_due ?? 0;
    total += bal;
    const due = new Date(`${inv.due_date}T12:00:00`);
    const diffMs = today.getTime() - due.getTime();
    const daysPast = Math.floor(diffMs / 86400000);
    if (daysPast <= 0) notYetDue += bal;
    else if (daysPast <= 30) bucket1To30Cents += bal;
    else if (daysPast <= 60) bucket31To60Cents += bal;
    else if (daysPast <= 90) bucket61To90Cents += bal;
    else bucketOver90Cents += bal;

    detailRows.push({
      invoice_number: inv.invoice_number,
      payer_name: inv.payer_name,
      balance_due_cents: bal,
      due_date: inv.due_date,
      days_past_due: daysPast > 0 ? daysPast : 0,
    });
  }

  const summary: ReportSummaryRow[] = [
    { metricKey: "arOpenInvoiceCount", value: invRows.length },
    { metricKey: "arTotalBalanceCents", value: total },
    { metricKey: "arNotYetDueCents", value: notYetDue },
    { metricKey: "arDays1To30Cents", value: bucket1To30Cents },
    { metricKey: "arDays31To60Cents", value: bucket31To60Cents },
    { metricKey: "arDays61To90Cents", value: bucket61To90Cents },
    { metricKey: "arDaysOver90Cents", value: bucketOver90Cents },
  ];

  return {
    summary,
    rows: detailRows,
    footnotes: [
      "Aging buckets use invoice due date vs today (facility time should align with org close processes). Past-due balances are summed by calendar-day age.",
    ],
  };
}

const FALL_CATEGORIES = [
  "fall_with_injury",
  "fall_without_injury",
  "fall_witnessed",
  "fall_unwitnessed",
] as const;

async function runIncidentTrendSummary(params: ExecuteParams): Promise<ReportExecutionResult> {
  const { supabase, organizationId, facilityId } = params;
  const facilityScoped = isValidFacilityIdForQuery(facilityId);
  const since = isoDateDaysAgo(30);

  let q = supabase
    .from("incidents")
    .select("id, category, discovered_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("discovered_at", since);

  if (facilityScoped) q = q.eq("facility_id", facilityId!);

  const [incRes, kpi] = await Promise.all([
    q,
    fetchExecutiveKpiSnapshot(supabase, organizationId, facilityId),
  ]);
  if (incRes.error) throw new Error(incRes.error.message);
  const rows = incRes.data ?? [];

  let fallCt = 0;
  let medCt = 0;
  for (const r of rows) {
    if (FALL_CATEGORIES.includes(r.category as (typeof FALL_CATEGORIES)[number])) fallCt += 1;
    if (r.category === "medication_error" || r.category === "medication_refusal") medCt += 1;
  }

  const detailRows = rows.slice(0, 500).map((r) => ({
    id: r.id,
    category: r.category,
    discovered_at: r.discovered_at,
  }));

  const incidents30dTotal = rows.length;

  return {
    summary: [
      { metricKey: "incidentsRecorded30d", value: incidents30dTotal },
      { metricKey: "incidentsFallRelated30d", value: fallCt },
      { metricKey: "incidentsMedicationRelated30d", value: medCt },
      { metricKey: "openIncidentsSnapshot", value: kpi.clinical.openIncidents },
    ],
    rows: detailRows,
    footnotes: ["30-day window is rolling from today. Detail rows are capped at 500 in the preview; export CSV for the full extract."],
  };
}

async function runStaffingCoverageByShift(params: ExecuteParams): Promise<ReportExecutionResult> {
  const { supabase, organizationId, facilityId } = params;
  const facilityScoped = isValidFacilityIdForQuery(facilityId);
  const start = isoDateDaysAgo(14);

  let q = supabase
    .from("shift_assignments")
    .select("id, shift_type, shift_date")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("shift_date", start);

  if (facilityScoped) q = q.eq("facility_id", facilityId!);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  let dayCt = 0;
  let eveCt = 0;
  let nightCt = 0;
  for (const r of rows) {
    if (r.shift_type === "day") dayCt += 1;
    else if (r.shift_type === "evening") eveCt += 1;
    else if (r.shift_type === "night") nightCt += 1;
  }

  const shiftAssignmentRowCount = rows.length;

  return {
    summary: [
      { metricKey: "shiftAssignmentsScheduled14d", value: shiftAssignmentRowCount },
      { metricKey: "coverageDayShifts14d", value: dayCt },
      { metricKey: "coverageEveningShifts14d", value: eveCt },
      { metricKey: "coverageNightShifts14d", value: nightCt },
    ],
    rows: rows.slice(0, 500).map((r) => ({
      shift_date: r.shift_date,
      shift_type: r.shift_type,
      id: r.id,
    })),
    footnotes: [
      "Counts scheduled shift assignments in the published schedule for the next two weeks (including today).",
    ],
  };
}

async function runOvertimeLaborPressure(params: ExecuteParams): Promise<ReportExecutionResult> {
  const { supabase, organizationId, facilityId } = params;
  const facilityScoped = isValidFacilityIdForQuery(facilityId);
  const since = isoDateDaysAgo(30);
  const sinceIso = `${since}T00:00:00.000Z`;

  let q = supabase
    .from("time_records")
    .select("id, staff_id, overtime_hours, clock_in")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("clock_in", sinceIso);

  if (facilityScoped) q = q.eq("facility_id", facilityId!);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  let otHours = 0;
  const staffWithOt = new Set<string>();
  for (const r of rows) {
    const ot = r.overtime_hours ?? 0;
    if (ot > 0) {
      otHours += ot;
      staffWithOt.add(r.staff_id);
    }
  }

  const timeRecordRowCount = rows.length;

  return {
    summary: [
      { metricKey: "timePunches30d", value: timeRecordRowCount },
      { metricKey: "overtimeHoursTotal30d", value: Math.round(otHours * 10) / 10 },
      { metricKey: "distinctStaffWithOvertime30d", value: staffWithOt.size },
    ],
    rows: rows
      .filter((r) => (r.overtime_hours ?? 0) > 0)
      .slice(0, 500)
      .map((r) => ({
        staff_id: r.staff_id,
        overtime_hours: r.overtime_hours,
        clock_in: r.clock_in,
      })),
    footnotes: ["Overtime hours are summed from approved time records in the rolling 30-day window."],
  };
}

async function runMedicationExceptionReport(params: ExecuteParams): Promise<ReportExecutionResult> {
  const { supabase, organizationId, facilityId } = params;
  const facilityScoped = isValidFacilityIdForQuery(facilityId);
  const ytd = startOfYearIsoDate();
  const now = new Date();
  const mtdStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`;

  let qYtd = supabase
    .from("medication_errors")
    .select("id, occurred_at, severity, error_type")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("occurred_at", ytd);

  let qMtd = supabase
    .from("medication_errors")
    .select("id, occurred_at, severity, error_type")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("occurred_at", mtdStart);

  if (facilityScoped) {
    qYtd = qYtd.eq("facility_id", facilityId!);
    qMtd = qMtd.eq("facility_id", facilityId!);
  }

  const [ytdRes, mtdRes, kpi] = await Promise.all([
    qYtd,
    qMtd,
    fetchExecutiveKpiSnapshot(supabase, organizationId, facilityId),
  ]);

  if (ytdRes.error) throw new Error(ytdRes.error.message);
  if (mtdRes.error) throw new Error(mtdRes.error.message);

  const ytdRows = ytdRes.data ?? [];
  const mtdRows = mtdRes.data ?? [];

  return {
    summary: [
      { metricKey: "medicationErrorsMtd", value: kpi.clinical.medicationErrorsMtd },
      { metricKey: "medicationErrorsYtd", value: ytdRows.length },
    ],
    rows: mtdRows.slice(0, 500).map((r) => ({
      occurred_at: r.occurred_at,
      severity: r.severity,
      error_type: r.error_type,
      id: r.id,
    })),
    footnotes: [
      "MTD uses the executive KPI definition (calendar month). YTD counts all medication events since Jan 1 UTC.",
    ],
  };
}

async function runResidentAssuranceRounding(params: ExecuteParams): Promise<ReportExecutionResult> {
  const { supabase, organizationId, facilityId } = params;
  const facilityScoped = isValidFacilityIdForQuery(facilityId);
  const startIso = isoDateDaysAgo(7);
  const endIso = isoNow();

  let q = supabase
    .from("resident_observation_tasks")
    .select("id, status, due_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("due_at", startIso)
    .lte("due_at", endIso);

  if (facilityScoped) q = q.eq("facility_id", facilityId!);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const completed = rows.filter((r) =>
    ["completed_on_time", "completed_late"].includes(r.status),
  ).length;
  const overdue = rows.filter((r) =>
    ["overdue", "critically_overdue", "missed"].includes(r.status),
  ).length;
  const total = rows.length;
  const onTimePct = total > 0 ? Math.round((completed / total) * 1000) / 10 : null;

  return {
    summary: [
      { metricKey: "roundingTasksDue7d", value: total },
      { metricKey: "roundingTasksCompleted7d", value: completed },
      { metricKey: "roundingTasksOverdue7d", value: overdue },
      { metricKey: "roundingOnTimePct7d", value: onTimePct },
    ],
    rows: [],
    footnotes: [
      "7-day window: tasks with due time between seven days ago and now. On-time rate = (completed on time or late) ÷ all tasks due in window.",
    ],
  };
}

async function runTrainingCertificationExpiry(params: ExecuteParams): Promise<ReportExecutionResult> {
  const { supabase, organizationId, facilityId } = params;
  const facilityScoped = isValidFacilityIdForQuery(facilityId);
  const { today, plus30 } = (() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const p = new Date(now);
    p.setUTCDate(p.getUTCDate() + 30);
    return { today, plus30: p.toISOString().slice(0, 10) };
  })();

  let staffQ = supabase
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .eq("employment_status", "active");

  if (facilityScoped) staffQ = staffQ.eq("facility_id", facilityId!);

  let certQ = supabase
    .from("staff_certifications")
    .select("id, certification_name, expiration_date, staff_id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .eq("status", "active")
    .not("expiration_date", "is", null)
    .gte("expiration_date", today)
    .lte("expiration_date", plus30);

  if (facilityScoped) certQ = certQ.eq("facility_id", facilityId!);

  const [staffRes, certRes, kpi] = await Promise.all([
    staffQ,
    certQ,
    fetchExecutiveKpiSnapshot(supabase, organizationId, facilityId),
  ]);

  if (staffRes.error) throw new Error(staffRes.error.message);
  if (certRes.error) throw new Error(certRes.error.message);

  const certs = certRes.data ?? [];
  const staffIds = [...new Set(certs.map((c) => c.staff_id))];
  let nameById = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: staffRows, error: staffNameErr } = await supabase
      .from("staff")
      .select("id, first_name, last_name")
      .eq("organization_id", organizationId)
      .in("id", staffIds);
    if (staffNameErr) throw new Error(staffNameErr.message);
    nameById = new Map(
      (staffRows ?? []).map((s) => [
        s.id,
        `${s.first_name} ${s.last_name}`.trim(),
      ]),
    );
  }

  const detailRows = certs.slice(0, 500).map((row) => ({
    staff_name: nameById.get(row.staff_id) ?? row.staff_id,
    certification_name: row.certification_name,
    expiration_date: row.expiration_date,
  }));

  return {
    summary: [
      { metricKey: "certificationsExpiring30d", value: kpi.workforce.certificationsExpiring30d },
      { metricKey: "activeStaffCount", value: staffRes.count ?? 0 },
    ],
    rows: detailRows,
    footnotes: ["Expiry window is rolling 30 days from today for active certifications."],
  };
}

async function runSurveyReadinessSummary(params: ExecuteParams): Promise<ReportExecutionResult> {
  const { supabase, organizationId, facilityId } = params;
  const facilityScoped = isValidFacilityIdForQuery(facilityId);
  const since = isoDateDaysAgo(30);

  let closedQ = supabase
    .from("survey_deficiencies")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .not("corrected_at", "is", null)
    .gte("corrected_at", since);

  if (facilityScoped) closedQ = closedQ.eq("facility_id", facilityId!);

  const kpi = await fetchExecutiveKpiSnapshot(supabase, organizationId, facilityId);

  const { count, error } = await closedQ;
  if (error) throw new Error(error.message);

  const deficienciesClosedInWindow = count ?? 0;

  return {
    summary: [
      { metricKey: "openSurveyDeficiencies", value: kpi.compliance.openSurveyDeficiencies },
      { metricKey: "surveyDeficienciesClosed30d", value: deficienciesClosedInWindow },
    ],
    rows: [],
    footnotes: [
      "Closed count includes deficiencies with a correction timestamp in the last 30 days.",
    ],
  };
}

const EXECUTOR_REGISTRY: Record<string, Executor> = {
  "occupancy-census-summary": runExecutiveSnapshot,
  "facility-operating-scorecard": runFacilityOperatingScorecard,
  "incident-trend-summary": runIncidentTrendSummary,
  "staffing-coverage-by-shift": runStaffingCoverageByShift,
  "overtime-labor-pressure": runOvertimeLaborPressure,
  "medication-exception-report": runMedicationExceptionReport,
  "resident-assurance-rounding-compliance": runResidentAssuranceRounding,
  "ar-aging-summary": runArAgingSummary,
  "training-certification-expiry": runTrainingCertificationExpiry,
  "survey-readiness-summary": runSurveyReadinessSummary,
  "executive-weekly-operating-pack": runExecutiveWeeklyPack,
};

export async function executeReportTemplate(
  slug: string,
  params: ExecuteParams,
): Promise<ReportExecutionResult> {
  const executor = EXECUTOR_REGISTRY[slug] ?? runExecutiveSnapshot;
  return executor(params);
}
