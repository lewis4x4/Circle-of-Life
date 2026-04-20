import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStandupPacketDocument } from "@/lib/executive/standup-packet";
import type { Database } from "@/types/database";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type StandupSourceMode = "auto" | "manual" | "hybrid" | "forecast";
export type StandupValueType = "currency" | "count" | "percent" | "hours" | "text";

export type StandupSectionKey =
  | "ar_census"
  | "bed_availability"
  | "admissions"
  | "risk_management"
  | "staffing"
  | "marketing";

export type StandupMetricDefinition = {
  key: string;
  sectionKey: StandupSectionKey;
  label: string;
  valueType: StandupValueType;
  sourceMode: StandupSourceMode;
  description: string;
};

export type StandupMetricRow = StandupMetricDefinition & {
  valueNumeric: number | null;
  valueText: string | null;
  freshnessAt: string | null;
  confidenceBand: "high" | "medium" | "low";
  sourceRefJson: Array<Record<string, unknown>>;
  overrideNote: string | null;
};

export type StandupFacilityLive = {
  facilityId: string | null;
  facilityName: string;
  metrics: Record<string, StandupMetricRow>;
  pressureScore: number;
  topConcern: string;
};

export type ExecutiveStandupLive = {
  generatedAt: string;
  weekOf: string;
  completedLastWeekStart: string;
  completedLastWeekEnd: string;
  facilities: StandupFacilityLive[];
};

export type StandupHistoryItem = {
  id: string;
  weekOf: string;
  status: string;
  generatedAt: string;
  publishedAt: string | null;
  completenessPct: number;
  confidenceBand: "high" | "medium" | "low";
};

export type StandupImportJob = {
  id: string;
  sourceFileName: string;
  sourceKind: "xlsx" | "csv" | "manual";
  status: "queued" | "running" | "completed" | "failed";
  importedWeekCount: number;
  importedMetricCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorText: string | null;
  createdAt: string;
};

export type StandupSnapshotDetail = {
  snapshot: {
    id: string;
    weekOf: string;
    status: string;
    generatedAt: string;
    generatedById: string | null;
    generatedByName: string | null;
    publishedAt: string | null;
    publishedById: string | null;
    publishedByName: string | null;
    completenessPct: number;
    confidenceBand: "high" | "medium" | "low";
    draftNotes: string | null;
    reviewNotes: string | null;
    publishedVersion: number;
    pdfAttachmentPath: string | null;
  };
  facilities: StandupFacilityLive[];
};

export type StandupNarrative = {
  headline: string;
  bullets: string[];
  changes: string[];
  dataQuality: string[];
  actions: string[];
  facilityActions: StandupFacilityAction[];
};

export type StandupSectionStatus = {
  sectionKey: StandupSectionKey;
  sectionLabel: string;
  totalRows: number;
  autoRows: number;
  manualRows: number;
  forecastRows: number;
  unresolvedRows: number;
  lowConfidenceRows: number;
  status: "ready" | "needs_manual" | "needs_forecast" | "needs_review";
};

export type StandupPublishReadiness = {
  canPublish: boolean;
  blockers: string[];
};

export type StandupComparisonFacility = {
  facilityId: string | null;
  facilityName: string;
  pressureFrom: number;
  pressureTo: number;
  pressureDelta: number;
  concernFrom: string;
  concernTo: string;
  metricDeltas: string[];
};

export type StandupComparison = {
  fromWeek: string;
  toWeek: string;
  headline: string;
  portfolioDeltas: string[];
  facilityComparisons: StandupComparisonFacility[];
};

export type StandupFacilityAction = {
  facilityId: string | null;
  facilityName: string;
  pressureScore: number;
  topConcern: string;
  whyRed: string[];
  varianceFlags: string[];
  interventions: string[];
};

type FacilityMini = {
  id: string;
  name: string;
  total_licensed_beds: number | null;
};

type InvoiceMini = {
  facility_id: string;
  balance_due: number;
  due_date: string;
  total: number;
  period_start: string | null;
  deleted_at: string | null;
  status: string;
};

type ResidentMini = {
  facility_id: string;
  status: string | null;
  discharge_target_date: string | null;
  monthly_total_rate?: number | null;
};

type StaffMini = {
  facility_id: string;
  termination_date: string | null;
};

type TimeRecordMini = {
  facility_id: string;
  overtime_hours: number | null;
  clock_in: string;
};

type BedMini = {
  facility_id: string;
  status: string | null;
  current_resident_id: string | null;
  standup_availability_class: "private" | "sp_female" | "sp_male" | "sp_flexible" | null;
  is_temporarily_blocked: boolean | null;
};

type AttendanceEventMini = {
  facility_id: string;
  event_type: "callout" | "late_callout" | "no_show" | "left_early" | "attendance_note";
  occurred_at: string;
};

type RequisitionMini = {
  facility_id: string;
  status: "draft" | "open" | "interviewing" | "offered" | "filled" | "cancelled";
};

type AdmissionCaseMini = {
  facility_id: string;
  status: string;
  target_move_in_date: string | null;
};

type OutreachActivityMini = {
  facility_id: string;
  activity_type: "home_health_provider" | "provider_visit" | "facility_outreach" | "community_event" | "digital_outreach";
  status: "planned" | "completed" | "cancelled";
  scheduled_for: string | null;
  performed_for_week: string | null;
};

type SnapshotMini = {
  id: string;
  status: string;
  generated_at: string;
  completeness_pct: number;
  confidence_band: "high" | "medium" | "low";
};

type SnapshotDetailRow = SnapshotMini & {
  week_of: string;
  generated_by: string | null;
  published_at: string | null;
  published_by: string | null;
  draft_notes: string | null;
  review_notes: string | null;
  published_version: number;
  pdf_attachment_path: string | null;
};

type UserProfileMini = {
  id: string;
  full_name: string;
};

type StandupImportJobRow = {
  id: string;
  source_file_name: string;
  source_kind: "xlsx" | "csv" | "manual";
  status: "queued" | "running" | "completed" | "failed";
  imported_week_count: number;
  imported_metric_count: number;
  started_at: string | null;
  finished_at: string | null;
  error_text: string | null;
  created_at: string;
};

type SnapshotMetricDbRow = {
  id: string;
  facility_id: string | null;
  section_key: StandupSectionKey;
  metric_key: string;
  metric_label: string;
  value_numeric: number | null;
  value_text: string | null;
  source_mode: StandupSourceMode;
  confidence_band: "high" | "medium" | "low";
  freshness_at: string | null;
  source_ref_json: Array<Record<string, unknown>> | null;
  override_note: string | null;
};

export const STANDUP_SECTION_LABELS: Record<StandupSectionKey, string> = {
  ar_census: "Accounts Receivable & Census",
  bed_availability: "Current Bed Availability",
  admissions: "Expected Admissions This Week",
  risk_management: "Risk Management",
  staffing: "Staffing",
  marketing: "Marketing Plans For This Week",
};

export const STANDUP_METRIC_DEFINITIONS: StandupMetricDefinition[] = [
  {
    key: "ar_goal_cents",
    sectionKey: "ar_census",
    label: "Goal",
    valueType: "currency",
    sourceMode: "manual",
    description: "Weekly AR target used during executive standup.",
  },
  {
    key: "current_ar_cents",
    sectionKey: "ar_census",
    label: "Current AR",
    valueType: "currency",
    sourceMode: "auto",
    description: "Current open invoice balances for the selected scope.",
  },
  {
    key: "current_total_census",
    sectionKey: "ar_census",
    label: "Current Total Census",
    valueType: "count",
    sourceMode: "auto",
    description: "Current active census including hospital hold / LOA.",
  },
  {
    key: "average_rent_cents",
    sectionKey: "ar_census",
    label: "Average Rent",
    valueType: "currency",
    sourceMode: "auto",
    description: "Average current-month billed revenue per invoiced resident.",
  },
  {
    key: "uncollected_ar_total_cents",
    sectionKey: "ar_census",
    label: "Uncollected AR Total",
    valueType: "currency",
    sourceMode: "auto",
    description: "Open overdue balances for the selected scope.",
  },
  {
    key: "sp_female_beds_open",
    sectionKey: "bed_availability",
    label: "SP Female Beds Open",
    valueType: "count",
    sourceMode: "auto",
    description: "Semi-private female-designated beds currently available.",
  },
  {
    key: "sp_male_beds_open",
    sectionKey: "bed_availability",
    label: "SP Male Beds Open",
    valueType: "count",
    sourceMode: "auto",
    description: "Semi-private male-designated beds currently available.",
  },
  {
    key: "sp_flexible_beds_open",
    sectionKey: "bed_availability",
    label: "SP Male or Female Beds Open",
    valueType: "count",
    sourceMode: "auto",
    description: "Semi-private flexible beds currently available.",
  },
  {
    key: "private_beds_open",
    sectionKey: "bed_availability",
    label: "Private Beds Open",
    valueType: "count",
    sourceMode: "auto",
    description: "Private beds currently available.",
  },
  {
    key: "total_beds_open",
    sectionKey: "bed_availability",
    label: "Total Beds Open",
    valueType: "count",
    sourceMode: "auto",
    description: "Licensed beds minus current census.",
  },
  {
    key: "admissions_expected",
    sectionKey: "admissions",
    label: "Admissions Expected",
    valueType: "count",
    sourceMode: "forecast",
    description: "Expected admissions for the current standup week.",
  },
  {
    key: "hospital_and_rehab_total",
    sectionKey: "risk_management",
    label: "Total at the Hospital & Rehab",
    valueType: "count",
    sourceMode: "hybrid",
    description: "Residents currently away in hospital hold or LOA.",
  },
  {
    key: "expected_discharges",
    sectionKey: "risk_management",
    label: "Expected Discharges",
    valueType: "count",
    sourceMode: "forecast",
    description: "Expected discharges during the current standup week.",
  },
  {
    key: "callouts_last_week",
    sectionKey: "staffing",
    label: "Call Outs Last Week",
    valueType: "count",
    sourceMode: "auto",
    description: "Attendance-related callouts recorded in the prior week.",
  },
  {
    key: "terminations_last_week",
    sectionKey: "staffing",
    label: "Terminations Last Week",
    valueType: "count",
    sourceMode: "auto",
    description: "Staff terminations recorded in the prior completed week.",
  },
  {
    key: "current_open_positions",
    sectionKey: "staffing",
    label: "Current Open Positions",
    valueType: "count",
    sourceMode: "auto",
    description: "Current open requisitions / vacancies.",
  },
  {
    key: "overtime_hours",
    sectionKey: "staffing",
    label: "Overtime",
    valueType: "hours",
    sourceMode: "auto",
    description: "Overtime hours recorded in the prior completed week.",
  },
  {
    key: "tours_expected",
    sectionKey: "marketing",
    label: "Tours Expected",
    valueType: "count",
    sourceMode: "auto",
    description: "Expected tours for the current standup week.",
  },
  {
    key: "provider_activities_expected",
    sectionKey: "marketing",
    label: "Activities on the calendar to be completed by Home Health Providers",
    valueType: "count",
    sourceMode: "auto",
    description: "Provider calendar activities expected during the week.",
  },
  {
    key: "outreach_engagements",
    sectionKey: "marketing",
    label: "Outreach & Engagements (Providers, Facilities, Events)",
    valueType: "count",
    sourceMode: "auto",
    description: "Outreach and engagement activities for the standup week.",
  },
];

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfWeekMonday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d;
}

function endOfWeekSunday(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function previousWeekStart(currentWeekStart: Date): Date {
  const d = new Date(currentWeekStart);
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function metricTemplate(
  definition: StandupMetricDefinition,
  valueNumeric: number | null,
  {
    confidenceBand = valueNumeric == null ? "low" : definition.sourceMode === "auto" ? "high" : "medium",
    freshnessAt = valueNumeric == null ? null : new Date().toISOString(),
    sourceRefJson = valueNumeric == null ? [] : [],
    overrideNote = valueNumeric == null ? "Needs manual or future system capture." : null,
  }: {
    confidenceBand?: "high" | "medium" | "low";
    freshnessAt?: string | null;
    sourceRefJson?: Array<Record<string, unknown>>;
    overrideNote?: string | null;
  } = {},
): StandupMetricRow {
  return {
    ...definition,
    valueNumeric,
    valueText: null,
    freshnessAt,
    confidenceBand,
    sourceRefJson,
    overrideNote,
  };
}

function initializeMetricMap(): Record<string, StandupMetricRow> {
  return Object.fromEntries(
    STANDUP_METRIC_DEFINITIONS.map((definition) => [
      definition.key,
      metricTemplate(definition, null, { sourceRefJson: [] }),
    ]),
  );
}

function sum(numbers: number[]): number {
  return numbers.reduce((acc, value) => acc + value, 0);
}

function computePressureScore(metrics: Record<string, StandupMetricRow>): { score: number; topConcern: string } {
  const currentAr = metrics.current_ar_cents.valueNumeric ?? 0;
  const totalBedsOpen = metrics.total_beds_open.valueNumeric ?? 0;
  const hospitalAndRehab = metrics.hospital_and_rehab_total.valueNumeric ?? 0;
  const terminations = metrics.terminations_last_week.valueNumeric ?? 0;
  const overtime = metrics.overtime_hours.valueNumeric ?? 0;
  const callouts = metrics.callouts_last_week.valueNumeric ?? 0;
  const openPositions = metrics.current_open_positions.valueNumeric ?? 0;

  let score = 0;
  let topConcern = "Stable operating picture";

  if (currentAr > 150_000_00) {
    score += 3;
    topConcern = "AR pressure is elevated";
  }
  if (totalBedsOpen === 0) {
    score += 2;
    topConcern = "No bed availability";
  }
  if (hospitalAndRehab >= 3) {
    score += 2;
    topConcern = "Hospital / rehab volume is elevated";
  }
  if (terminations > 0) {
    score += 1;
    topConcern = "Recent terminations need staffing attention";
  }
  if (overtime >= 20) {
    score += 1;
    topConcern = "Overtime pressure is building";
  }
  if (callouts >= 3) {
    score += 1;
    topConcern = "Callout volume is elevated";
  }
  if (openPositions >= 2) {
    score += 1;
    topConcern = "Open positions are affecting coverage";
  }

  return { score, topConcern };
}

function buildPressureReasons(metrics: Record<string, StandupMetricRow>): string[] {
  const reasons: string[] = [];
  const currentAr = metrics.current_ar_cents.valueNumeric ?? 0;
  const totalBedsOpen = metrics.total_beds_open.valueNumeric ?? 0;
  const hospitalAndRehab = metrics.hospital_and_rehab_total.valueNumeric ?? 0;
  const terminations = metrics.terminations_last_week.valueNumeric ?? 0;
  const overtime = metrics.overtime_hours.valueNumeric ?? 0;
  const callouts = metrics.callouts_last_week.valueNumeric ?? 0;
  const openPositions = metrics.current_open_positions.valueNumeric ?? 0;

  if (currentAr > 150_000_00) reasons.push(`Open AR is elevated at ${formatCurrencyFromCents(currentAr)}.`);
  if (totalBedsOpen === 0) reasons.push("No beds are currently open.");
  if (hospitalAndRehab >= 3) reasons.push(`${hospitalAndRehab} residents are in hospital or rehab status.`);
  if (terminations > 0) reasons.push(`${terminations} terminations were recorded in the last week.`);
  if (overtime >= 20) reasons.push(`Overtime reached ${metrics.overtime_hours.valueNumeric?.toFixed(2) ?? overtime} hours.`);
  if (callouts >= 3) reasons.push(`${callouts} callouts were logged in the last week.`);
  if (openPositions >= 2) reasons.push(`${openPositions} open positions are still unfilled.`);

  return reasons;
}

function buildFacilityVarianceFlags(
  current: StandupFacilityLive,
  previous: StandupFacilityLive | null,
): string[] {
  if (!previous) return [];

  const flags = [
    deltaLine("AR", current.metrics.current_ar_cents.valueNumeric ?? null, previous.metrics.current_ar_cents.valueNumeric ?? null, formatCurrencyFromCents),
    deltaLine("Census", current.metrics.current_total_census.valueNumeric ?? null, previous.metrics.current_total_census.valueNumeric ?? null),
    deltaLine("Open beds", current.metrics.total_beds_open.valueNumeric ?? null, previous.metrics.total_beds_open.valueNumeric ?? null),
    deltaLine("Callouts", current.metrics.callouts_last_week.valueNumeric ?? null, previous.metrics.callouts_last_week.valueNumeric ?? null),
    deltaLine("Overtime", current.metrics.overtime_hours.valueNumeric ?? null, previous.metrics.overtime_hours.valueNumeric ?? null, (value) => value == null ? "—" : `${value.toFixed(2)} hrs`),
    deltaLine("Open positions", current.metrics.current_open_positions.valueNumeric ?? null, previous.metrics.current_open_positions.valueNumeric ?? null),
  ].filter((flag): flag is string => Boolean(flag));

  return flags.slice(0, 4);
}

function buildFacilityInterventions(metrics: Record<string, StandupMetricRow>): string[] {
  const interventions: string[] = [];
  const currentAr = metrics.current_ar_cents.valueNumeric ?? 0;
  const totalBedsOpen = metrics.total_beds_open.valueNumeric ?? 0;
  const hospitalAndRehab = metrics.hospital_and_rehab_total.valueNumeric ?? 0;
  const overtime = metrics.overtime_hours.valueNumeric ?? 0;
  const callouts = metrics.callouts_last_week.valueNumeric ?? 0;
  const openPositions = metrics.current_open_positions.valueNumeric ?? 0;

  if (currentAr > 150_000_00) {
    interventions.push("Review the largest receivable balances, payer holds, and collection assignments today.");
  }
  if (totalBedsOpen === 0 || hospitalAndRehab >= 3) {
    interventions.push("Confirm discharge/return timing and release blocked beds before accepting additional move-ins.");
  }
  if (callouts >= 3 || overtime >= 20 || openPositions >= 2) {
    interventions.push("Escalate staffing coverage: PRN/agency fill, requisition follow-up, and shift rebalancing today.");
  }
  if (interventions.length === 0) {
    interventions.push("Maintain current operating plan and monitor changes at the next standup refresh.");
  }

  return interventions.slice(0, 3);
}

export function buildStandupActionEngine(
  currentFacilities: StandupFacilityLive[],
  previousFacilities?: StandupFacilityLive[] | null,
): StandupFacilityAction[] {
  const previousByFacilityId = new Map((previousFacilities ?? []).map((facility) => [facility.facilityId, facility] as const));

  return currentFacilities
    .filter((facility) => facility.facilityId != null)
    .map((facility) => {
      const previous = previousByFacilityId.get(facility.facilityId) ?? null;
      const whyRed = buildPressureReasons(facility.metrics);
      const varianceFlags = buildFacilityVarianceFlags(facility, previous);
      const interventions = buildFacilityInterventions(facility.metrics);
      return {
        facilityId: facility.facilityId,
        facilityName: facility.facilityName,
        pressureScore: facility.pressureScore,
        topConcern: facility.topConcern,
        whyRed,
        varianceFlags,
        interventions,
      };
    })
    .sort((a, b) => b.pressureScore - a.pressureScore || a.facilityName.localeCompare(b.facilityName));
}

export function buildStandupInsights(facilities: StandupFacilityLive[]): string[] {
  const liveFacilities = facilities.filter((facility) => facility.facilityId != null);
  const top = [...liveFacilities].sort((a, b) => b.pressureScore - a.pressureScore).slice(0, 3);
  const insights: string[] = [];

  if (top.length > 0) {
    insights.push(`${top[0].facilityName} is the highest-pressure facility right now: ${top[0].topConcern}.`);
  }

  const highestAr = [...liveFacilities].sort(
    (a, b) => (b.metrics.current_ar_cents.valueNumeric ?? 0) - (a.metrics.current_ar_cents.valueNumeric ?? 0),
  )[0];
  if (highestAr && (highestAr.metrics.current_ar_cents.valueNumeric ?? 0) > 0) {
    insights.push(`${highestAr.facilityName} has the highest open AR at ${highestAr.metrics.current_ar_cents.valueNumeric ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(highestAr.metrics.current_ar_cents.valueNumeric / 100) : "—"}.`);
  }

  const noBedFlex = liveFacilities.filter((facility) => (facility.metrics.total_beds_open.valueNumeric ?? 0) === 0);
  if (noBedFlex.length > 0) {
    insights.push(`${noBedFlex.map((facility) => facility.facilityName).join(", ")} currently has no open bed capacity.`);
  }

  return insights.slice(0, 3);
}

export function summarizeStandupSections(detail: StandupSnapshotDetail): StandupSectionStatus[] {
  return (Object.entries(STANDUP_SECTION_LABELS) as Array<[StandupSectionKey, string]>).map(([sectionKey, sectionLabel]) => {
    const rows = detail.facilities
      .filter((facility) => facility.facilityId != null)
      .flatMap((facility) =>
        Object.values(facility.metrics).filter((metric) => metric.sectionKey === sectionKey),
      );

    const autoRows = rows.filter((metric) => metric.sourceMode === "auto").length;
    const manualRows = rows.filter((metric) => metric.sourceMode === "manual").length;
    const forecastRows = rows.filter((metric) => metric.sourceMode === "forecast").length;
    const unresolvedRows = rows.filter((metric) => metric.valueNumeric == null && !(metric.valueText?.trim())).length;
    const lowConfidenceRows = rows.filter((metric) => metric.confidenceBand === "low").length;

    let status: StandupSectionStatus["status"] = "ready";
    if (rows.some((metric) => metric.sourceMode === "manual" && metric.valueNumeric == null && !(metric.valueText?.trim()))) {
      status = "needs_manual";
    } else if (rows.some((metric) => metric.sourceMode === "forecast" && metric.valueNumeric == null && !(metric.valueText?.trim()))) {
      status = "needs_forecast";
    } else if (lowConfidenceRows > 0 || rows.some((metric) => metric.sourceMode === "manual" || metric.sourceMode === "forecast" || metric.sourceMode === "hybrid")) {
      status = "needs_review";
    }

    return {
      sectionKey,
      sectionLabel,
      totalRows: rows.length,
      autoRows,
      manualRows,
      forecastRows,
      unresolvedRows,
      lowConfidenceRows,
      status,
    };
  });
}

export function evaluateStandupPublishReadiness(
  detail: StandupSnapshotDetail,
  reviewNotes: string,
): StandupPublishReadiness {
  const blockers: string[] = [];
  const sections = summarizeStandupSections(detail);
  const unresolved = sections.reduce((acc, section) => acc + section.unresolvedRows, 0);
  const lowConfidence = sections.reduce((acc, section) => acc + section.lowConfidenceRows, 0);

  if (detail.snapshot.status !== "draft") {
    blockers.push("Only draft weeks can be published.");
  }
  if (unresolved > 0) {
    blockers.push(`${unresolved} metric cells are still unresolved.`);
  }
  if (!reviewNotes.trim()) {
    blockers.push("Review notes are required before publish.");
  }
  if (detail.snapshot.completenessPct < 85) {
    blockers.push(`Completeness is ${detail.snapshot.completenessPct.toFixed(0)}%; target is at least 85% before publish.`);
  }
  if (lowConfidence > 0) {
    blockers.push(`${lowConfidence} metric cells remain low confidence and require review.`);
  }

  return {
    canPublish: blockers.length === 0,
    blockers,
  };
}

export function buildStandupComparison(
  fromDetail: StandupSnapshotDetail,
  toDetail: StandupSnapshotDetail,
): StandupComparison {
  const fromTotals = fromDetail.facilities.find((facility) => facility.facilityId == null) ?? null;
  const toTotals = toDetail.facilities.find((facility) => facility.facilityId == null) ?? null;
  const portfolioDeltas = [
    deltaLine("AR", toTotals?.metrics.current_ar_cents.valueNumeric ?? null, fromTotals?.metrics.current_ar_cents.valueNumeric ?? null, formatCurrencyFromCents),
    deltaLine("Census", toTotals?.metrics.current_total_census.valueNumeric ?? null, fromTotals?.metrics.current_total_census.valueNumeric ?? null),
    deltaLine("Open beds", toTotals?.metrics.total_beds_open.valueNumeric ?? null, fromTotals?.metrics.total_beds_open.valueNumeric ?? null),
    deltaLine("Hospital / rehab", toTotals?.metrics.hospital_and_rehab_total.valueNumeric ?? null, fromTotals?.metrics.hospital_and_rehab_total.valueNumeric ?? null),
    deltaLine("Callouts", toTotals?.metrics.callouts_last_week.valueNumeric ?? null, fromTotals?.metrics.callouts_last_week.valueNumeric ?? null),
    deltaLine("Overtime", toTotals?.metrics.overtime_hours.valueNumeric ?? null, fromTotals?.metrics.overtime_hours.valueNumeric ?? null, (value) => value == null ? "—" : `${value.toFixed(2)} hrs`),
  ].filter((line): line is string => Boolean(line));

  const fromByFacilityId = new Map(fromDetail.facilities.filter((facility) => facility.facilityId != null).map((facility) => [facility.facilityId, facility] as const));
  const toByFacilityId = new Map(toDetail.facilities.filter((facility) => facility.facilityId != null).map((facility) => [facility.facilityId, facility] as const));
  const facilityIds = Array.from(new Set([...fromByFacilityId.keys(), ...toByFacilityId.keys()]));

  const facilityComparisons = facilityIds
    .map((facilityId) => {
      const fromFacility = fromByFacilityId.get(facilityId) ?? null;
      const toFacility = toByFacilityId.get(facilityId) ?? null;
      const facilityName = toFacility?.facilityName ?? fromFacility?.facilityName ?? "Facility";
      const pressureFrom = fromFacility?.pressureScore ?? 0;
      const pressureTo = toFacility?.pressureScore ?? 0;
      const metricDeltas = [
        deltaLine("AR", toFacility?.metrics.current_ar_cents.valueNumeric ?? null, fromFacility?.metrics.current_ar_cents.valueNumeric ?? null, formatCurrencyFromCents),
        deltaLine("Census", toFacility?.metrics.current_total_census.valueNumeric ?? null, fromFacility?.metrics.current_total_census.valueNumeric ?? null),
        deltaLine("Open beds", toFacility?.metrics.total_beds_open.valueNumeric ?? null, fromFacility?.metrics.total_beds_open.valueNumeric ?? null),
        deltaLine("Callouts", toFacility?.metrics.callouts_last_week.valueNumeric ?? null, fromFacility?.metrics.callouts_last_week.valueNumeric ?? null),
        deltaLine("Open positions", toFacility?.metrics.current_open_positions.valueNumeric ?? null, fromFacility?.metrics.current_open_positions.valueNumeric ?? null),
      ].filter((line): line is string => Boolean(line));

      return {
        facilityId,
        facilityName,
        pressureFrom,
        pressureTo,
        pressureDelta: pressureTo - pressureFrom,
        concernFrom: fromFacility?.topConcern ?? "No prior concern",
        concernTo: toFacility?.topConcern ?? "No current concern",
        metricDeltas,
      };
    })
    .sort((a, b) => Math.abs(b.pressureDelta) - Math.abs(a.pressureDelta) || b.pressureTo - a.pressureTo || a.facilityName.localeCompare(b.facilityName));

  const highestShift = facilityComparisons[0];
  const headline = highestShift
    ? `${highestShift.facilityName} changed the most between ${fromDetail.snapshot.weekOf} and ${toDetail.snapshot.weekOf}.`
    : `Comparison ready for ${fromDetail.snapshot.weekOf} versus ${toDetail.snapshot.weekOf}.`;

  return {
    fromWeek: fromDetail.snapshot.weekOf,
    toWeek: toDetail.snapshot.weekOf,
    headline,
    portfolioDeltas,
    facilityComparisons,
  };
}

export function currentStandupWeekOf(): string {
  return toIsoDate(startOfWeekMonday());
}

export function standupMetricDefinitionByKey(metricKey: string): StandupMetricDefinition | undefined {
  return STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === metricKey);
}

function composeSnapshotFacilities(
  facilities: FacilityMini[],
  metricRows: SnapshotMetricDbRow[],
): StandupFacilityLive[] {
  const facilityMap = new Map<string | null, StandupFacilityLive>();

  for (const facility of facilities) {
    facilityMap.set(facility.id, {
      facilityId: facility.id,
      facilityName: facility.name,
      metrics: initializeMetricMap(),
      pressureScore: 0,
      topConcern: "Stable operating picture",
    });
  }

  facilityMap.set(null, {
    facilityId: null,
    facilityName: "Totals",
    metrics: initializeMetricMap(),
    pressureScore: 0,
    topConcern: "Stable operating picture",
  });

  for (const row of metricRows) {
    const definition = standupMetricDefinitionByKey(row.metric_key);
    if (!definition) continue;

    const facility = facilityMap.get(row.facility_id ?? null);
    if (!facility) continue;

    facility.metrics[row.metric_key] = {
      ...definition,
      valueNumeric: row.value_numeric,
      valueText: row.value_text,
      freshnessAt: row.freshness_at,
      confidenceBand: row.confidence_band,
      sourceRefJson: row.source_ref_json ?? [],
      overrideNote: row.override_note,
    };
  }

  const values = Array.from(facilityMap.values()).map((facility) => {
    const { score, topConcern } = computePressureScore(facility.metrics);
    return {
      ...facility,
      pressureScore: score,
      topConcern,
    };
  });

  return values.sort((a, b) => {
    if (a.facilityName === "Totals") return 1;
    if (b.facilityName === "Totals") return -1;
    return b.pressureScore - a.pressureScore || a.facilityName.localeCompare(b.facilityName);
  });
}

function aggregateSnapshotMetricValue(metricKey: string, facilityRows: SnapshotMetricDbRow[]): number | null {
  const definition = standupMetricDefinitionByKey(metricKey);
  if (!definition) return null;
  const numericValues = facilityRows.map((row) => row.value_numeric).filter((value): value is number => value != null);
  if (numericValues.length === 0) return null;
  if (metricKey === "average_rent_cents") {
    return Math.round(sum(numericValues) / numericValues.length);
  }
  return sum(numericValues);
}

function formatCurrencyFromCents(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function formatMetricDisplay(metric: StandupMetricRow | undefined): string {
  if (!metric) return "—";
  if (metric.valueText?.trim()) return metric.valueText.trim();
  if (metric.valueNumeric == null) return "—";
  if (metric.valueType === "currency") return formatCurrencyFromCents(metric.valueNumeric);
  if (metric.valueType === "hours") return `${metric.valueNumeric.toFixed(2)} hrs`;
  if (metric.valueType === "percent") return `${metric.valueNumeric.toFixed(1)}%`;
  return `${metric.valueNumeric}`;
}

function formatDateTimeDisplay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function deltaLine(label: string, current: number | null, previous: number | null, formatter?: (value: number | null) => string): string | null {
  if (current == null || previous == null || current === previous) return null;
  const delta = current - previous;
  const direction = delta > 0 ? "up" : "down";
  const amount = formatter ? formatter(Math.abs(delta)) : `${Math.abs(delta)}`;
  return `${label} is ${direction} ${amount} versus the prior published week.`;
}

export async function fetchStandupSnapshotForWeek(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  weekOf: string,
): Promise<SnapshotMini | null> {
  const { data, error } = await supabase
    .from("exec_standup_snapshots" as never)
    .select("id, status, generated_at, completeness_pct, confidence_band")
    .eq("organization_id", organizationId)
    .eq("week_of", weekOf)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SnapshotMini | null) ?? null;
}

export async function fetchStandupHistory(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  limit = 26,
): Promise<StandupHistoryItem[]> {
  const { data, error } = await supabase
    .from("exec_standup_snapshots" as never)
    .select("id, week_of, status, generated_at, published_at, completeness_pct, confidence_band")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("week_of", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return ((data as Array<SnapshotDetailRow> | null) ?? []).map((row) => ({
    id: row.id,
    weekOf: row.week_of,
    status: row.status,
    generatedAt: row.generated_at,
    publishedAt: row.published_at,
    completenessPct: row.completeness_pct,
    confidenceBand: row.confidence_band,
  }));
}

export async function fetchStandupImportJobs(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  limit = 10,
): Promise<StandupImportJob[]> {
  const { data, error } = await supabase
    .from("exec_standup_import_jobs" as never)
    .select("id, source_file_name, source_kind, status, imported_week_count, imported_metric_count, started_at, finished_at, error_text, created_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return ((data as StandupImportJobRow[] | null) ?? []).map((row) => ({
    id: row.id,
    sourceFileName: row.source_file_name,
    sourceKind: row.source_kind,
    status: row.status,
    importedWeekCount: row.imported_week_count,
    importedMetricCount: row.imported_metric_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorText: row.error_text,
    createdAt: row.created_at,
  }));
}

export function buildStandupImportCommand(workbookPath: string, organizationId?: string | null): string {
  const orgPrefix = organizationId ? `HAVEN_ORGANIZATION_ID="${organizationId}" ` : "";
  return `${orgPrefix}NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" python3 scripts/import-executive-standup-workbook.py "${workbookPath}"`;
}

export function buildStandupPdfUrl(weekOf: string): string {
  return `/api/executive/standup/${encodeURIComponent(weekOf)}/pdf`;
}

export async function saveStandupBoardReport(
  supabase: SupabaseClient<Database>,
  input: {
    organizationId: string;
    userId: string;
    weekOf: string;
    status?: string;
    confidenceBand?: "high" | "medium" | "low";
    version?: number;
    publishedAt?: string | null;
    completenessPct?: number;
  },
): Promise<string> {
  const existing = await supabase
    .from("exec_saved_reports")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("template", "custom")
    .contains("parameters", {
      kind: "executive_standup_board_packet",
      weekOf: input.weekOf,
    })
    .is("deleted_at", null)
    .maybeSingle();

  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return existing.data.id;

  const insert = await supabase
    .from("exec_saved_reports")
    .insert({
      organization_id: input.organizationId,
      created_by: input.userId,
      name: `Executive Standup Board Packet — ${input.weekOf}`,
      template: "custom",
      parameters: {
        kind: "executive_standup_board_packet",
        weekOf: input.weekOf,
        status: input.status ?? null,
        confidenceBand: input.confidenceBand ?? null,
        version: input.version ?? null,
        publishedAt: input.publishedAt ?? null,
        completenessPct: input.completenessPct ?? null,
      },
    })
    .select("id")
    .single();

  if (insert.error || !insert.data?.id) {
    throw new Error(insert.error?.message ?? "Could not save board packet report.");
  }

  return insert.data.id;
}

export async function fetchPreviousPublishedStandupSnapshotDetail(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  weekOf: string,
): Promise<StandupSnapshotDetail | null> {
  const { data, error } = await supabase
    .from("exec_standup_snapshots" as never)
    .select("week_of")
    .eq("organization_id", organizationId)
    .eq("status", "published")
    .lt("week_of", weekOf)
    .is("deleted_at", null)
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const prevWeek = (data as { week_of: string } | null)?.week_of;
  if (!prevWeek) return null;
  return fetchStandupSnapshotDetail(supabase, organizationId, prevWeek);
}

export async function fetchStandupSnapshotDetail(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  weekOf: string,
): Promise<StandupSnapshotDetail | null> {
  const [snapshotRes, facilitiesRes] = await Promise.all([
    supabase
      .from("exec_standup_snapshots" as never)
      .select("id, week_of, status, generated_at, generated_by, published_at, published_by, completeness_pct, confidence_band, draft_notes, review_notes, published_version, pdf_attachment_path")
      .eq("organization_id", organizationId)
      .eq("week_of", weekOf)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("facilities" as never)
      .select("id, name, total_licensed_beds")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
  ]);

  const snapshotResult = snapshotRes as unknown as { data: SnapshotDetailRow | null; error: { message: string } | null };
  const facilitiesResult = facilitiesRes as unknown as { data: FacilityMini[] | null; error: { message: string } | null };

  if (snapshotResult.error) throw new Error(snapshotResult.error.message);
  if (facilitiesResult.error) throw new Error(facilitiesResult.error.message);
  if (!snapshotResult.data) return null;

  const profileIds = Array.from(new Set([snapshotResult.data.generated_by, snapshotResult.data.published_by].filter((value): value is string => Boolean(value))));
  const profileRes = profileIds.length > 0
    ? ((await supabase
        .from("user_profiles" as never)
        .select("id, full_name")
        .in("id", profileIds)
        .is("deleted_at", null)) as unknown as { data: UserProfileMini[] | null; error: { message: string } | null })
    : { data: [] as UserProfileMini[], error: null };
  if (profileRes.error) throw new Error(profileRes.error.message);
  const profileById = new Map((profileRes.data ?? []).map((profile) => [profile.id, profile.full_name] as const));

  const metricsRes = await supabase
    .from("exec_standup_snapshot_metrics" as never)
    .select("id, facility_id, section_key, metric_key, metric_label, value_numeric, value_text, source_mode, confidence_band, freshness_at, source_ref_json, override_note")
    .eq("snapshot_id", snapshotResult.data.id)
    .is("deleted_at", null);

  const metricsResult = metricsRes as unknown as { data: SnapshotMetricDbRow[] | null; error: { message: string } | null };
  if (metricsResult.error) throw new Error(metricsResult.error.message);

  return {
    snapshot: {
      id: snapshotResult.data.id,
      weekOf: snapshotResult.data.week_of,
      status: snapshotResult.data.status,
      generatedAt: snapshotResult.data.generated_at,
      generatedById: snapshotResult.data.generated_by,
      generatedByName: snapshotResult.data.generated_by ? profileById.get(snapshotResult.data.generated_by) ?? null : null,
      publishedAt: snapshotResult.data.published_at,
      publishedById: snapshotResult.data.published_by,
      publishedByName: snapshotResult.data.published_by ? profileById.get(snapshotResult.data.published_by) ?? null : null,
      completenessPct: snapshotResult.data.completeness_pct,
      confidenceBand: snapshotResult.data.confidence_band,
      draftNotes: snapshotResult.data.draft_notes,
      reviewNotes: snapshotResult.data.review_notes,
      publishedVersion: snapshotResult.data.published_version,
      pdfAttachmentPath: snapshotResult.data.pdf_attachment_path,
    },
    facilities: composeSnapshotFacilities(facilitiesResult.data ?? [], metricsResult.data ?? []),
  };
}

export async function fetchExecutiveStandupLive(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  facilityId: string | null,
): Promise<ExecutiveStandupLive> {
  let facilitiesQuery = supabase
    .from("facilities" as never)
    .select("id, name, total_licensed_beds")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (isValidFacilityIdForQuery(facilityId)) {
    facilitiesQuery = facilitiesQuery.eq("id", facilityId);
  }

  const facilitiesRes = (await facilitiesQuery) as unknown as { data: FacilityMini[] | null; error: { message: string } | null };
  if (facilitiesRes.error) throw new Error(facilitiesRes.error.message);

  const facilities = facilitiesRes.data ?? [];
  const facilityIds = facilities.map((row) => row.id);
  const weekStart = startOfWeekMonday();
  const prevWeekStart = previousWeekStart(weekStart);
  const prevWeekEnd = endOfWeekSunday(prevWeekStart);
  const thisWeekEnd = endOfWeekSunday(weekStart);
  const monthStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
  const todayIso = toIsoDate(new Date());

  let invoicesQ = supabase
    .from("invoices" as never)
    .select("facility_id, balance_due, due_date, total, period_start, deleted_at, status")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["draft", "sent", "partial", "overdue"])
    .limit(5000);

  let residentsQ = supabase
    .from("residents" as never)
    .select("facility_id, status, discharge_target_date, monthly_total_rate")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .limit(5000);

  let staffQ = supabase
    .from("staff" as never)
    .select("facility_id, termination_date")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .limit(5000);

  let timeQ = supabase
    .from("time_records" as never)
    .select("facility_id, overtime_hours, clock_in")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .limit(5000);

  let bedsQ = supabase
    .from("beds" as never)
    .select("facility_id, status, current_resident_id, standup_availability_class, is_temporarily_blocked")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .limit(5000);

  let attendanceQ = supabase
    .from("staff_attendance_events" as never)
    .select("facility_id, event_type, occurred_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .limit(5000);

  let requisitionsQ = supabase
    .from("staff_requisitions" as never)
    .select("facility_id, status")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .limit(5000);

  let admissionCasesQ = supabase
    .from("admission_cases" as never)
    .select("facility_id, status, target_move_in_date")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .limit(5000);

  let outreachQ = supabase
    .from("referral_outreach_activities" as never)
    .select("facility_id, activity_type, status, scheduled_for, performed_for_week")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .limit(5000);

  let referralToursQ = supabase
    .from("referral_leads" as never)
    .select("facility_id, status, tour_scheduled_for")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .limit(5000);

  if (facilityIds.length > 0 && !isValidFacilityIdForQuery(facilityId)) {
    invoicesQ = invoicesQ.in("facility_id", facilityIds);
    residentsQ = residentsQ.in("facility_id", facilityIds);
    staffQ = staffQ.in("facility_id", facilityIds);
    timeQ = timeQ.in("facility_id", facilityIds);
    bedsQ = bedsQ.in("facility_id", facilityIds);
    attendanceQ = attendanceQ.in("facility_id", facilityIds);
    requisitionsQ = requisitionsQ.in("facility_id", facilityIds);
    admissionCasesQ = admissionCasesQ.in("facility_id", facilityIds);
    outreachQ = outreachQ.in("facility_id", facilityIds);
    referralToursQ = referralToursQ.in("facility_id", facilityIds);
  } else if (isValidFacilityIdForQuery(facilityId)) {
    invoicesQ = invoicesQ.eq("facility_id", facilityId);
    residentsQ = residentsQ.eq("facility_id", facilityId);
    staffQ = staffQ.eq("facility_id", facilityId);
    timeQ = timeQ.eq("facility_id", facilityId);
    bedsQ = bedsQ.eq("facility_id", facilityId);
    attendanceQ = attendanceQ.eq("facility_id", facilityId);
    requisitionsQ = requisitionsQ.eq("facility_id", facilityId);
    admissionCasesQ = admissionCasesQ.eq("facility_id", facilityId);
    outreachQ = outreachQ.eq("facility_id", facilityId);
    referralToursQ = referralToursQ.eq("facility_id", facilityId);
  }

  const [invoicesRes, residentsRes, staffRes, timeRes, bedsRes, attendanceRes, requisitionsRes, admissionCasesRes, outreachRes, referralToursRes] = await Promise.all([
    invoicesQ as unknown as Promise<{ data: InvoiceMini[] | null; error: { message: string } | null }>,
    residentsQ as unknown as Promise<{ data: ResidentMini[] | null; error: { message: string } | null }>,
    staffQ as unknown as Promise<{ data: StaffMini[] | null; error: { message: string } | null }>,
    timeQ as unknown as Promise<{ data: TimeRecordMini[] | null; error: { message: string } | null }>,
    bedsQ as unknown as Promise<{ data: BedMini[] | null; error: { message: string } | null }>,
    attendanceQ as unknown as Promise<{ data: AttendanceEventMini[] | null; error: { message: string } | null }>,
    requisitionsQ as unknown as Promise<{ data: RequisitionMini[] | null; error: { message: string } | null }>,
    admissionCasesQ as unknown as Promise<{ data: AdmissionCaseMini[] | null; error: { message: string } | null }>,
    outreachQ as unknown as Promise<{ data: OutreachActivityMini[] | null; error: { message: string } | null }>,
    referralToursQ as unknown as Promise<{ data: Array<{ facility_id: string; status: string; tour_scheduled_for: string | null }> | null; error: { message: string } | null }>,
  ]);

  for (const result of [invoicesRes, residentsRes, staffRes, timeRes, bedsRes, attendanceRes, requisitionsRes, admissionCasesRes, outreachRes, referralToursRes]) {
    if (result.error) throw new Error(result.error.message);
  }

  const invoiceRows = invoicesRes.data ?? [];
  const residentRows = residentsRes.data ?? [];
  const staffRows = staffRes.data ?? [];
  const timeRows = timeRes.data ?? [];
  const bedRows = bedsRes.data ?? [];
  const attendanceRows = attendanceRes.data ?? [];
  const requisitionRows = requisitionsRes.data ?? [];
  const admissionCaseRows = admissionCasesRes.data ?? [];
  const outreachRows = outreachRes.data ?? [];
  const referralTourRows = referralToursRes.data ?? [];

  const liveFacilities = facilities.map<StandupFacilityLive>((facility) => {
    const metrics = initializeMetricMap();
    const facilityInvoices = invoiceRows.filter((row) => row.facility_id === facility.id);
    const facilityResidents = residentRows.filter((row) => row.facility_id === facility.id);
    const facilityStaff = staffRows.filter((row) => row.facility_id === facility.id);
    const facilityTime = timeRows.filter((row) => row.facility_id === facility.id);
    const facilityBeds = bedRows.filter((row) => row.facility_id === facility.id);
    const facilityAttendance = attendanceRows.filter((row) => row.facility_id === facility.id);
    const facilityRequisitions = requisitionRows.filter((row) => row.facility_id === facility.id);
    const facilityAdmissionCases = admissionCaseRows.filter((row) => row.facility_id === facility.id);
    const facilityOutreach = outreachRows.filter((row) => row.facility_id === facility.id);
    const facilityTours = referralTourRows.filter((row) => row.facility_id === facility.id);

    const currentArCents = sum(facilityInvoices.map((row) => Math.max(0, row.balance_due ?? 0)));
    const overdueArCents = sum(
      facilityInvoices
        .filter((row) => row.due_date && row.due_date < todayIso)
        .map((row) => Math.max(0, row.balance_due ?? 0)),
    );
    const currentTotalCensus = facilityResidents.filter((row) => ["active", "hospital_hold", "loa"].includes(row.status ?? "")).length;
    const openBeds = facilityBeds.filter((row) => row.current_resident_id == null && !row.is_temporarily_blocked && (row.status ?? "available") === "available");
    const totalBedsOpen = facilityBeds.length > 0 ? openBeds.length : Math.max(0, (facility.total_licensed_beds ?? 0) - currentTotalCensus);
    const spFemaleBedsOpen = openBeds.filter((row) => row.standup_availability_class === "sp_female").length;
    const spMaleBedsOpen = openBeds.filter((row) => row.standup_availability_class === "sp_male").length;
    const spFlexibleBedsOpen = openBeds.filter((row) => row.standup_availability_class === "sp_flexible").length;
    const privateBedsOpen = openBeds.filter((row) => row.standup_availability_class === "private").length;
    const hospitalAndRehab = facilityResidents.filter((row) => ["hospital_hold", "loa"].includes(row.status ?? "")).length;
    const admissionsExpected = facilityAdmissionCases.filter((row) => {
      if (!row.target_move_in_date || row.status === "cancelled") return false;
      return row.target_move_in_date >= toIsoDate(weekStart) && row.target_move_in_date <= toIsoDate(thisWeekEnd);
    }).length;
    const expectedDischarges = facilityResidents.filter((row) => {
      if (!row.discharge_target_date) return false;
      return row.discharge_target_date >= toIsoDate(weekStart) && row.discharge_target_date <= toIsoDate(thisWeekEnd);
    }).length;
    const calloutsLastWeek = facilityAttendance.filter((row) => {
      return row.occurred_at >= `${toIsoDate(prevWeekStart)}T00:00:00.000Z`
        && row.occurred_at <= `${toIsoDate(prevWeekEnd)}T23:59:59.999Z`
        && ["callout", "late_callout", "no_show", "left_early"].includes(row.event_type);
    }).length;
    const terminationsLastWeek = facilityStaff.filter((row) => {
      if (!row.termination_date) return false;
      return row.termination_date >= toIsoDate(prevWeekStart) && row.termination_date <= toIsoDate(prevWeekEnd);
    }).length;
    const currentOpenPositions = facilityRequisitions.filter((row) => ["open", "interviewing", "offered"].includes(row.status)).length;
    const overtimeHours = Math.round(
      facilityTime
        .filter((row) => row.clock_in >= `${toIsoDate(prevWeekStart)}T00:00:00.000Z` && row.clock_in <= `${toIsoDate(prevWeekEnd)}T23:59:59.999Z`)
        .reduce((acc, row) => acc + (row.overtime_hours ?? 0), 0) * 100,
    ) / 100;
    const toursExpected = facilityTours.filter((row) => {
      if (!row.tour_scheduled_for || ["lost", "merged"].includes(row.status)) return false;
      return row.tour_scheduled_for >= `${toIsoDate(weekStart)}T00:00:00.000Z`
        && row.tour_scheduled_for <= `${toIsoDate(thisWeekEnd)}T23:59:59.999Z`;
    }).length;
    const providerActivitiesExpected = facilityOutreach.filter((row) => {
      if (row.status === "cancelled" || row.activity_type !== "home_health_provider") return false;
      return row.performed_for_week === toIsoDate(weekStart)
        || (row.scheduled_for != null
          && row.scheduled_for >= `${toIsoDate(weekStart)}T00:00:00.000Z`
          && row.scheduled_for <= `${toIsoDate(thisWeekEnd)}T23:59:59.999Z`);
    }).length;
    const outreachEngagements = facilityOutreach.filter((row) => {
      if (row.status === "cancelled" || row.activity_type === "home_health_provider") return false;
      return row.performed_for_week === toIsoDate(weekStart)
        || (row.scheduled_for != null
          && row.scheduled_for >= `${toIsoDate(weekStart)}T00:00:00.000Z`
          && row.scheduled_for <= `${toIsoDate(thisWeekEnd)}T23:59:59.999Z`);
    }).length;

    const currentMonthInvoices = facilityInvoices.filter((row) => row.period_start?.startsWith(toIsoDate(monthStart).slice(0, 7)));
    const residentRateRows = facilityResidents
      .map((row) => row.monthly_total_rate)
      .filter((value): value is number => value != null && value > 0);
    const averageRentFromInvoices =
      currentMonthInvoices.length > 0
        ? Math.round(sum(currentMonthInvoices.map((row) => row.total ?? 0)) / currentMonthInvoices.length)
        : null;
    const averageRentFromRates =
      residentRateRows.length > 0
        ? Math.round(sum(residentRateRows) / residentRateRows.length)
        : null;
    const averageRentCents = averageRentFromInvoices ?? averageRentFromRates;
    const averageRentConfidence: "high" | "medium" | "low" =
      averageRentFromInvoices != null && currentMonthInvoices.length >= Math.max(1, currentTotalCensus)
        ? "high"
        : averageRentFromInvoices != null || averageRentFromRates != null
          ? "medium"
          : "low";

    metrics.current_ar_cents = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "current_ar_cents")!,
      currentArCents,
      { sourceRefJson: [{ table: "invoices", mode: "open_balance" }] },
    );
    metrics.current_total_census = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "current_total_census")!,
      currentTotalCensus,
      { sourceRefJson: [{ table: "residents", statuses: ["active", "hospital_hold", "loa"] }] },
    );
    metrics.average_rent_cents = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "average_rent_cents")!,
      averageRentCents,
      {
        confidenceBand: averageRentConfidence,
        sourceRefJson:
          averageRentFromInvoices != null
            ? [{ table: "invoices", mode: "current_month_average_total" }]
            : averageRentFromRates != null
              ? [{ table: "residents", field: "monthly_total_rate" }]
              : [],
        overrideNote:
          averageRentFromInvoices != null && currentMonthInvoices.length < Math.max(1, currentTotalCensus)
            ? "Computed from partial invoice coverage; review confidence before publishing."
            : null,
      },
    );
    metrics.uncollected_ar_total_cents = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "uncollected_ar_total_cents")!,
      overdueArCents,
      { sourceRefJson: [{ table: "invoices", mode: "overdue_balance" }] },
    );
    metrics.total_beds_open = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "total_beds_open")!,
      totalBedsOpen,
      { sourceRefJson: facilityBeds.length > 0 ? [{ table: "beds", field: "standup_availability_class" }] : [{ table: "facilities", field: "total_licensed_beds" }, { table: "residents", field: "status" }] },
    );
    metrics.sp_female_beds_open = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "sp_female_beds_open")!,
      spFemaleBedsOpen,
      { sourceRefJson: [{ table: "beds", field: "standup_availability_class" }] },
    );
    metrics.sp_male_beds_open = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "sp_male_beds_open")!,
      spMaleBedsOpen,
      { sourceRefJson: [{ table: "beds", field: "standup_availability_class" }] },
    );
    metrics.sp_flexible_beds_open = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "sp_flexible_beds_open")!,
      spFlexibleBedsOpen,
      { sourceRefJson: [{ table: "beds", field: "standup_availability_class" }] },
    );
    metrics.private_beds_open = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "private_beds_open")!,
      privateBedsOpen,
      { sourceRefJson: [{ table: "beds", field: "standup_availability_class" }] },
    );
    metrics.hospital_and_rehab_total = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "hospital_and_rehab_total")!,
      hospitalAndRehab,
      {
        confidenceBand: "medium",
        sourceRefJson: [{ table: "residents", statuses: ["hospital_hold", "loa"] }],
        overrideNote: "Counts hospital hold and LOA. Rehab-specific distinction still needs a dedicated status model.",
      },
    );
    metrics.expected_discharges = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "expected_discharges")!,
      expectedDischarges,
      {
        confidenceBand: "medium",
        sourceRefJson: [{ table: "residents", field: "discharge_target_date" }],
        overrideNote: expectedDischarges > 0 ? "Derived from resident discharge target dates for the standup week." : "No discharge targets recorded for this week.",
      },
    );
    metrics.admissions_expected = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "admissions_expected")!,
      admissionsExpected,
      {
        confidenceBand: admissionsExpected > 0 ? "medium" : "low",
        sourceRefJson: [{ table: "admission_cases", field: "target_move_in_date" }],
        overrideNote: admissionsExpected > 0 ? "Derived from admission cases targeting move-in during the standup week." : "No admission cases target this standup week.",
      },
    );
    metrics.callouts_last_week = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "callouts_last_week")!,
      calloutsLastWeek,
      { sourceRefJson: [{ table: "staff_attendance_events", event_types: ["callout", "late_callout", "no_show", "left_early"] }] },
    );
    metrics.terminations_last_week = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "terminations_last_week")!,
      terminationsLastWeek,
      { sourceRefJson: [{ table: "staff", field: "termination_date" }] },
    );
    metrics.current_open_positions = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "current_open_positions")!,
      currentOpenPositions,
      { sourceRefJson: [{ table: "staff_requisitions", open_statuses: ["open", "interviewing", "offered"] }] },
    );
    metrics.overtime_hours = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "overtime_hours")!,
      overtimeHours,
      { sourceRefJson: [{ table: "time_records", field: "overtime_hours" }] },
    );
    metrics.tours_expected = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "tours_expected")!,
      toursExpected,
      { sourceRefJson: [{ table: "referral_leads", field: "tour_scheduled_for" }] },
    );
    metrics.provider_activities_expected = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "provider_activities_expected")!,
      providerActivitiesExpected,
      { sourceRefJson: [{ table: "referral_outreach_activities", activity_type: "home_health_provider" }] },
    );
    metrics.outreach_engagements = metricTemplate(
      STANDUP_METRIC_DEFINITIONS.find((metric) => metric.key === "outreach_engagements")!,
      outreachEngagements,
      { sourceRefJson: [{ table: "referral_outreach_activities", mode: "non_provider" }] },
    );

    const { score, topConcern } = computePressureScore(metrics);
    return {
      facilityId: facility.id,
      facilityName: facility.name,
      metrics,
      pressureScore: score,
      topConcern,
    };
  });

  if (liveFacilities.length === 0) {
    liveFacilities.push({
      facilityId: null,
      facilityName: "No facilities in scope",
      metrics: initializeMetricMap(),
      pressureScore: 0,
      topConcern: "No facilities available",
    });
  }

  const totalMetrics = initializeMetricMap();
  const totalCurrentMonthInvoices = invoiceRows.filter((row) => row.period_start?.startsWith(toIsoDate(monthStart).slice(0, 7)));
  const totalResidentRateRows = residentRows
    .map((row) => row.monthly_total_rate)
    .filter((value): value is number => value != null && value > 0);
  for (const definition of STANDUP_METRIC_DEFINITIONS) {
    const numericValues = liveFacilities
      .map((facility) => facility.metrics[definition.key]?.valueNumeric)
      .filter((value): value is number => value != null);

    const aggregateValue =
      numericValues.length === 0
        ? null
        : definition.key === "average_rent_cents"
          ? totalCurrentMonthInvoices.length > 0
            ? Math.round(sum(totalCurrentMonthInvoices.map((row) => row.total ?? 0)) / totalCurrentMonthInvoices.length)
            : totalResidentRateRows.length > 0
              ? Math.round(sum(totalResidentRateRows) / totalResidentRateRows.length)
              : null
          : sum(numericValues);

    totalMetrics[definition.key] = metricTemplate(definition, aggregateValue, {
      confidenceBand: aggregateValue == null ? "low" : definition.sourceMode === "auto" ? "high" : "medium",
      sourceRefJson: aggregateValue == null ? [] : [{ mode: "facility_rollup", facility_count: liveFacilities.length }],
      overrideNote: aggregateValue == null ? "Needs manual or future system capture." : null,
    });
  }

  const { score, topConcern } = computePressureScore(totalMetrics);
  liveFacilities.push({
    facilityId: null,
    facilityName: "Totals",
    metrics: totalMetrics,
    pressureScore: score,
    topConcern,
  });

  return {
    generatedAt: new Date().toISOString(),
    weekOf: toIsoDate(weekStart),
    completedLastWeekStart: toIsoDate(prevWeekStart),
    completedLastWeekEnd: toIsoDate(prevWeekEnd),
    facilities: liveFacilities.sort((a, b) => {
      if (a.facilityName === "Totals") return 1;
      if (b.facilityName === "Totals") return -1;
      return b.pressureScore - a.pressureScore || a.facilityName.localeCompare(b.facilityName);
    }),
  };
}

export async function generateExecutiveStandupDraft(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  userId: string,
  facilityId: string | null,
): Promise<SnapshotMini> {
  const weekOf = currentStandupWeekOf();
  const existing = await fetchStandupSnapshotForWeek(supabase, organizationId, weekOf);
  if (existing) return existing;

  const live = await fetchExecutiveStandupLive(supabase, organizationId, facilityId);
  const valueCount = live.facilities.flatMap((facility) => Object.values(facility.metrics)).filter((metric) => metric.valueNumeric != null || metric.valueText != null).length;
  const totalCount = live.facilities.flatMap((facility) => Object.values(facility.metrics)).length;
  const completenessPct = totalCount > 0 ? Math.round((valueCount / totalCount) * 10000) / 100 : 0;

  const snapshotInsert = await supabase
    .from("exec_standup_snapshots" as never)
    .insert({
      organization_id: organizationId,
      week_of: weekOf,
      status: "draft",
      generated_at: live.generatedAt,
      generated_by: userId,
      created_by: userId,
      updated_by: userId,
      confidence_band: completenessPct >= 70 ? "medium" : "low",
      completeness_pct: completenessPct,
      summary_json: {
        live_generated_at: live.generatedAt,
        facility_count: live.facilities.filter((facility) => facility.facilityId != null).length,
      },
    } as never)
    .select("id, status, generated_at, completeness_pct, confidence_band")
    .single();

  const snapshotRes = snapshotInsert as unknown as { data: SnapshotMini | null; error: { message: string } | null };
  if (snapshotRes.error || !snapshotRes.data) {
    throw new Error(snapshotRes.error?.message ?? "Could not create standup draft.");
  }

  const metricRows = live.facilities.flatMap((facility) =>
    Object.values(facility.metrics).map((metric) => ({
      snapshot_id: snapshotRes.data!.id,
      organization_id: organizationId,
      facility_id: facility.facilityId,
      section_key: metric.sectionKey,
      metric_key: metric.key,
      metric_label: metric.label,
      value_numeric: metric.valueNumeric,
      value_text: metric.valueText,
      source_mode: metric.valueNumeric == null && metric.sourceMode === "hybrid" ? "manual" : metric.sourceMode,
      confidence_band: metric.confidenceBand,
      totals_included: facility.facilityId == null,
      freshness_at: metric.freshnessAt,
      source_ref_json: metric.sourceRefJson,
      override_note: metric.overrideNote,
      created_by: userId,
      updated_by: userId,
    })),
  );

  const metricInsert = await supabase.from("exec_standup_snapshot_metrics" as never).insert(metricRows as never);
  const metricRes = metricInsert as unknown as { error: { message: string } | null };
  if (metricRes.error) {
    throw new Error(metricRes.error.message);
  }

  return snapshotRes.data;
}

export async function saveStandupMetricInput(
  supabase: SupabaseClient<Database>,
  input: {
    snapshotId: string;
    organizationId: string;
    weekOf: string;
    facilityId: string;
    metricKey: string;
    userId: string;
    valueNumeric?: number | null;
    valueText?: string | null;
    note?: string | null;
    sourceMode?: StandupSourceMode;
  },
): Promise<void> {
  const definition = standupMetricDefinitionByKey(input.metricKey);
  if (!definition) {
    throw new Error("Unknown standup metric.");
  }

  const effectiveSourceMode =
    input.sourceMode ?? (definition.sourceMode === "forecast" ? "forecast" : "manual");
  const confidenceBand = effectiveSourceMode === "forecast" ? "medium" : "low";

  if (effectiveSourceMode === "forecast") {
    const forecastRes = await supabase
      .from("exec_standup_forecast_entries" as never)
      .upsert({
        organization_id: input.organizationId,
        facility_id: input.facilityId,
        week_of: input.weekOf,
        metric_key: input.metricKey,
        expected_value_numeric: input.valueNumeric ?? null,
        expected_value_text: input.valueText ?? null,
        rationale: input.note ?? null,
        confidence_band: confidenceBand,
        entered_by: input.userId,
        created_by: input.userId,
        updated_by: input.userId,
      } as never, { onConflict: "facility_id,week_of,metric_key" });

    const forecastResult = forecastRes as unknown as { error: { message: string } | null };
    if (forecastResult.error) throw new Error(forecastResult.error.message);
  } else {
    const manualRes = await supabase
      .from("exec_standup_manual_entries" as never)
      .upsert({
        organization_id: input.organizationId,
        facility_id: input.facilityId,
        week_of: input.weekOf,
        section_key: definition.sectionKey,
        metric_key: input.metricKey,
        value_numeric: input.valueNumeric ?? null,
        value_text: input.valueText ?? null,
        note: input.note ?? null,
        confidence_band: confidenceBand,
        entered_by: input.userId,
        created_by: input.userId,
        updated_by: input.userId,
      } as never, { onConflict: "facility_id,week_of,section_key,metric_key" });

    const manualResult = manualRes as unknown as { error: { message: string } | null };
    if (manualResult.error) throw new Error(manualResult.error.message);
  }

  const metricPayload = {
    snapshot_id: input.snapshotId,
    organization_id: input.organizationId,
    facility_id: input.facilityId,
    section_key: definition.sectionKey,
    metric_key: input.metricKey,
    metric_label: definition.label,
    value_numeric: input.valueNumeric ?? null,
    value_text: input.valueText ?? null,
    source_mode: effectiveSourceMode,
    confidence_band: confidenceBand,
    freshness_at: new Date().toISOString(),
    source_ref_json: [{ mode: effectiveSourceMode, entry: "standup_input" }],
    override_note: input.note ?? null,
    updated_by: input.userId,
  };

  const existingMetricFetch = await supabase
    .from("exec_standup_snapshot_metrics" as never)
    .select("id")
    .eq("snapshot_id", input.snapshotId)
    .eq("facility_id", input.facilityId)
    .eq("metric_key", input.metricKey)
    .is("deleted_at", null)
    .maybeSingle();
  const existingMetricResult = existingMetricFetch as unknown as { data: { id: string } | null; error: { message: string } | null };
  if (existingMetricResult.error) throw new Error(existingMetricResult.error.message);

  if (existingMetricResult.data?.id) {
    const metricUpdateRes = await supabase
      .from("exec_standup_snapshot_metrics" as never)
      .update(metricPayload as never)
      .eq("id", existingMetricResult.data.id);
    const metricUpdateResult = metricUpdateRes as unknown as { error: { message: string } | null };
    if (metricUpdateResult.error) throw new Error(metricUpdateResult.error.message);
  } else {
    const metricInsertRes = await supabase
      .from("exec_standup_snapshot_metrics" as never)
      .insert({
        ...metricPayload,
        created_by: input.userId,
      } as never);
    const metricInsertResult = metricInsertRes as unknown as { error: { message: string } | null };
    if (metricInsertResult.error) throw new Error(metricInsertResult.error.message);
  }

  const facilityMetricFetch = await supabase
    .from("exec_standup_snapshot_metrics" as never)
    .select("id, facility_id, section_key, metric_key, metric_label, value_numeric, value_text, source_mode, confidence_band, freshness_at, source_ref_json, override_note")
    .eq("snapshot_id", input.snapshotId)
    .eq("metric_key", input.metricKey)
    .is("deleted_at", null);

  const facilityMetricResult = facilityMetricFetch as unknown as { data: SnapshotMetricDbRow[] | null; error: { message: string } | null };
  if (facilityMetricResult.error) throw new Error(facilityMetricResult.error.message);

  const facilityRows = (facilityMetricResult.data ?? []).filter((row) => row.facility_id != null);
  const totalValue = aggregateSnapshotMetricValue(input.metricKey, facilityRows);

  const totalMetricPayload = {
    snapshot_id: input.snapshotId,
    organization_id: input.organizationId,
    facility_id: null,
    section_key: definition.sectionKey,
    metric_key: input.metricKey,
    metric_label: definition.label,
    value_numeric: totalValue,
    value_text: null,
    source_mode: effectiveSourceMode === "forecast" ? "forecast" : definition.sourceMode === "auto" ? "auto" : "manual",
    confidence_band: confidenceBand,
    freshness_at: new Date().toISOString(),
    source_ref_json: [{ mode: "facility_rollup", metric_key: input.metricKey }],
    override_note: totalValue == null ? "Waiting on facility inputs." : null,
    totals_included: true,
    updated_by: input.userId,
  };

  const existingTotalFetch = await supabase
    .from("exec_standup_snapshot_metrics" as never)
    .select("id")
    .eq("snapshot_id", input.snapshotId)
    .is("facility_id", null)
    .eq("metric_key", input.metricKey)
    .is("deleted_at", null)
    .maybeSingle();
  const existingTotalResult = existingTotalFetch as unknown as { data: { id: string } | null; error: { message: string } | null };
  if (existingTotalResult.error) throw new Error(existingTotalResult.error.message);

  if (existingTotalResult.data?.id) {
    const totalMetricUpdateRes = await supabase
      .from("exec_standup_snapshot_metrics" as never)
      .update(totalMetricPayload as never)
      .eq("id", existingTotalResult.data.id);
    const totalMetricUpdateResult = totalMetricUpdateRes as unknown as { error: { message: string } | null };
    if (totalMetricUpdateResult.error) throw new Error(totalMetricUpdateResult.error.message);
  } else {
    const totalMetricInsertRes = await supabase
      .from("exec_standup_snapshot_metrics" as never)
      .insert({
        ...totalMetricPayload,
        created_by: input.userId,
      } as never);
    const totalMetricInsertResult = totalMetricInsertRes as unknown as { error: { message: string } | null };
    if (totalMetricInsertResult.error) throw new Error(totalMetricInsertResult.error.message);
  }

  const allMetricFetch = await supabase
    .from("exec_standup_snapshot_metrics" as never)
    .select("value_numeric, value_text")
    .eq("snapshot_id", input.snapshotId)
    .is("deleted_at", null);
  const allMetricResult = allMetricFetch as unknown as { data: Array<{ value_numeric: number | null; value_text: string | null }> | null; error: { message: string } | null };
  if (allMetricResult.error) throw new Error(allMetricResult.error.message);

  const allRows = allMetricResult.data ?? [];
  const completedCount = allRows.filter((row) => row.value_numeric != null || (row.value_text ?? "").trim() !== "").length;
  const completenessPct = allRows.length > 0 ? Math.round((completedCount / allRows.length) * 10000) / 100 : 0;

  const snapshotUpdateRes = await supabase
    .from("exec_standup_snapshots" as never)
    .update({
      completeness_pct: completenessPct,
      confidence_band: completenessPct >= 80 ? "medium" : "low",
      updated_by: input.userId,
    } as never)
    .eq("id", input.snapshotId);

  const snapshotUpdateResult = snapshotUpdateRes as unknown as { error: { message: string } | null };
  if (snapshotUpdateResult.error) throw new Error(snapshotUpdateResult.error.message);
}

export async function publishStandupSnapshot(
  supabase: SupabaseClient<Database>,
  input: {
    snapshotId: string;
    weekOf: string;
    userId: string;
    reviewNotes?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const res = await supabase
    .from("exec_standup_snapshots" as never)
    .update({
      status: "published",
      published_at: now,
      published_by: input.userId,
      review_notes: input.reviewNotes ?? null,
      pdf_attachment_path: buildStandupPdfUrl(input.weekOf),
      updated_by: input.userId,
    } as never)
    .eq("id", input.snapshotId)
    .eq("status", "draft");

  const result = res as unknown as { error: { message: string } | null };
  if (result.error) throw new Error(result.error.message);
}

export async function saveStandupSnapshotNotes(
  supabase: SupabaseClient<Database>,
  input: {
    snapshotId: string;
    userId: string;
    draftNotes?: string | null;
    reviewNotes?: string | null;
  },
): Promise<void> {
  const res = await supabase
    .from("exec_standup_snapshots" as never)
    .update({
      draft_notes: input.draftNotes ?? null,
      review_notes: input.reviewNotes ?? null,
      updated_by: input.userId,
    } as never)
    .eq("id", input.snapshotId);

  const result = res as unknown as { error: { message: string } | null };
  if (result.error) throw new Error(result.error.message);
}

export function buildStandupNarrative(
  current: StandupSnapshotDetail,
  previous: StandupSnapshotDetail | null,
): StandupNarrative {
  const currentFacilities = current.facilities.filter((facility) => facility.facilityId != null);
  const totals = current.facilities.find((facility) => facility.facilityId == null);
  const previousTotals = previous?.facilities.find((facility) => facility.facilityId == null) ?? null;
  const topFacility = [...currentFacilities].sort((a, b) => b.pressureScore - a.pressureScore)[0] ?? null;
  const unresolved = currentFacilities.flatMap((facility) => Object.values(facility.metrics)).filter((metric) => metric.valueNumeric == null && !(metric.valueText?.trim()));

  const bullets = buildStandupInsights(current.facilities);
  const facilityActions = buildStandupActionEngine(current.facilities, previous?.facilities ?? null);
  const changes = [
    deltaLine(
      "Open AR",
      totals?.metrics.current_ar_cents.valueNumeric ?? null,
      previousTotals?.metrics.current_ar_cents.valueNumeric ?? null,
      formatCurrencyFromCents,
    ),
    deltaLine(
      "Census",
      totals?.metrics.current_total_census.valueNumeric ?? null,
      previousTotals?.metrics.current_total_census.valueNumeric ?? null,
    ),
    deltaLine(
      "Open beds",
      totals?.metrics.total_beds_open.valueNumeric ?? null,
      previousTotals?.metrics.total_beds_open.valueNumeric ?? null,
    ),
    deltaLine(
      "Callouts",
      totals?.metrics.callouts_last_week.valueNumeric ?? null,
      previousTotals?.metrics.callouts_last_week.valueNumeric ?? null,
    ),
  ].filter((line): line is string => Boolean(line));

  const dataQuality: string[] = [];
  if (unresolved.length > 0) {
    dataQuality.push(`${unresolved.length} metric cells are still unresolved in the current packet.`);
  }
  const lowConfidence = currentFacilities.flatMap((facility) => Object.values(facility.metrics)).filter((metric) => metric.confidenceBand === "low");
  if (lowConfidence.length > 0) {
    dataQuality.push(`${lowConfidence.length} metric cells are marked low confidence and should be reviewed before publishing.`);
  }

  const headline = topFacility
    ? `${topFacility.facilityName} is the highest-pressure facility this week.`
    : "Portfolio packet is ready for executive review.";

  const actions = facilityActions
    .slice(0, 3)
    .map((facility) => `${facility.facilityName}: ${facility.interventions[0] ?? "No intervention recommendation."}`);

  return {
    headline,
    bullets,
    changes,
    dataQuality,
    actions,
    facilityActions,
  };
}

export function buildStandupBoardPrintHtml(
  detail: StandupSnapshotDetail,
  previous: StandupSnapshotDetail | null,
): string {
  const packet = buildStandupPacketDocument(detail, previous);
  const facilities = detail.facilities.filter((facility) => facility.facilityId != null);
  const totals = detail.facilities.find((facility) => facility.facilityId == null) ?? null;
  const generatedBy = packet.generatedBy;
  const publishedBy = packet.publishedBy;

  const sectionBlocks = packet.sections
    .map(
      (section) => `
        <section class="section">
          <div class="section-header">
            <div>
              <div class="eyebrow">${escapeHtml(section.sectionLabel)}</div>
              <h3>${escapeHtml(section.sectionLabel)}</h3>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Previous</th>
                <th>Current</th>
                <th>Delta</th>
                <th>Source</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              ${section.metrics
                .map(
                  (metric) => `
                    <tr>
                      <td>
                        <div class="metric-label">${escapeHtml(metric.label)}</div>
                        <div class="metric-desc">${escapeHtml(metric.description)}</div>
                      </td>
                      <td><div class="value">${escapeHtml(metric.fromValue)}</div></td>
                      <td><div class="value">${escapeHtml(metric.toValue)}</div></td>
                      <td><div class="delta">${escapeHtml(metric.delta)}</div></td>
                      <td><div class="meta">${escapeHtml(metric.sourceMode)}</div></td>
                      <td><div class="meta">${escapeHtml(metric.confidenceBand)}</div></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </section>
      `,
    )
    .join("");

  const appendixRows = packet.appendixSections
    .map(
      (section) => `
        <section class="section">
          <h3>${escapeHtml(section.sectionLabel)}</h3>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                ${facilities.map((facility) => `<th>${escapeHtml(facility.facilityName)}</th>`).join("")}
                ${totals ? "<th>Totals</th>" : ""}
              </tr>
            </thead>
            <tbody>
              ${section.metrics
                .map((metric) => {
                  const sample = facilities.find((facility) => facility.metrics[metric.key])?.metrics[metric.key] ?? totals?.metrics[metric.key];
                  if (!sample) return "";
                  const facilityCells = facilities
                    .map(
                      (facility) =>
                        `<td><div class="value">${escapeHtml(formatMetricDisplay(facility.metrics[metric.key]))}</div><div class="meta">${escapeHtml(
                          `${facility.metrics[metric.key].sourceMode} · ${facility.metrics[metric.key].confidenceBand}`,
                        )}</div></td>`,
                    )
                    .join("");
                  const totalCell = totals
                    ? `<td><div class="value">${escapeHtml(formatMetricDisplay(totals.metrics[metric.key]))}</div><div class="meta">${escapeHtml(
                        `${totals.metrics[metric.key].sourceMode} · ${totals.metrics[metric.key].confidenceBand}`,
                      )}</div></td>`
                    : "";
                  return `<tr><td><div class="metric-label">${escapeHtml(sample.label)}</div><div class="metric-desc">${escapeHtml(sample.description)}</div></td>${facilityCells}${totalCell}</tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </section>
      `,
    )
    .join("");

  const facilityRanking = facilities
    .slice()
    .sort((a, b) => b.pressureScore - a.pressureScore)
    .map(
      (facility, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(facility.facilityName)}</td><td>${escapeHtml(
          facility.topConcern,
        )}</td><td>${facility.pressureScore}</td></tr>`,
    )
    .join("");

  const portfolioSummary = totals
    ? `
      <div class="summary-grid">
        ${packet.summaryCards
          .map(
            (card) => `
              <div class="summary-card">
                <div class="summary-label">${escapeHtml(card.label)}</div>
                <div class="summary-value">${escapeHtml(card.value)}</div>
                <div class="summary-delta">${escapeHtml(card.delta)}</div>
              </div>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  const narrativeBullets = packet.narrative.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const narrativeChanges = packet.topChanges.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const narrativeQuality = packet.qualityFlags.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const narrativeActions = packet.topActions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const methodologyList = packet.methodology.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const legendList = packet.legend.map((item) => `<li><strong>${escapeHtml(item.label)}</strong>: ${escapeHtml(item.description)}</li>`).join("");
  const reviewNotesBlock = packet.reviewNotes
    ? `<div class="panel"><h2>Review notes</h2><p>${escapeHtml(packet.reviewNotes)}</p></div>`
    : "";
  const draftNotesBlock = packet.draftNotes
    ? `<div class="panel"><h2>Draft notes</h2><p>${escapeHtml(packet.draftNotes)}</p></div>`
    : "";
  const facilityActionPanels = packet.narrative.facilityActions
    .slice(0, 6)
    .map(
      (action) => `
        <div class="spotlight-card">
          <h2>${escapeHtml(action.facilityName)} <span style="font-size:12px;color:#64748b;">Pressure ${action.pressureScore}</span></h2>
          <div class="meta">${escapeHtml(action.topConcern)}</div>
          <h2 style="margin-top: 14px;">Why red</h2>
          <ul>${(action.whyRed.length > 0 ? action.whyRed : ["No active red flags beyond the summary concern."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <h2 style="margin-top: 14px;">Variance flags</h2>
          <ul>${(action.varianceFlags.length > 0 ? action.varianceFlags : ["No material week-over-week delta against the prior published packet."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <h2 style="margin-top: 14px;">Interventions</h2>
          <ul>${action.interventions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      `,
    )
    .join("");
  const comparisonPanels = packet.comparison
    ? packet.comparison.facilityComparisons
        .slice(0, 6)
        .map(
          (facility) => `
            <div class="spotlight-card">
              <h2>${escapeHtml(facility.facilityName)} <span style="font-size:12px;color:#64748b;">${facility.pressureDelta > 0 ? "+" : ""}${facility.pressureDelta} pressure</span></h2>
              <div class="meta">${escapeHtml(packet.comparison!.fromWeek)}: ${escapeHtml(facility.concernFrom)} · ${escapeHtml(packet.comparison!.toWeek)}: ${escapeHtml(facility.concernTo)}</div>
              <ul style="margin-top: 14px;">${(facility.metricDeltas.length > 0 ? facility.metricDeltas : ["No material metric shifts for this facility."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </div>
          `,
        )
        .join("")
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Executive Standup Pack — ${escapeHtml(detail.snapshot.weekOf)}</title>
    <style>
      :root {
        --bg: #f5f6fb;
        --ink: #111827;
        --muted: #667085;
        --line: #dbe2f0;
        --brand-1: #0f172a;
        --brand-2: #172554;
        --brand-3: #4338ca;
        --card: #ffffff;
        --accent: #0f766e;
        --danger: #991b1b;
      }
      body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; color: var(--ink); background: var(--bg); }
      .packet { max-width: 1120px; margin: 0 auto; }
      .page { background: var(--card); min-height: 100vh; padding: 36px; box-sizing: border-box; page-break-after: always; }
      .page:last-child { page-break-after: auto; }
      h1 { font-size: 2.8rem; margin: 0 0 12px; letter-spacing: -0.04em; line-height: 0.95; }
      h2 { font-size: 1.05rem; margin: 0 0 10px; letter-spacing: -0.01em; }
      h3 { font-size: 1.55rem; margin: 0 0 14px; letter-spacing: -0.03em; }
      .eyebrow { font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin-bottom: 8px; }
      .meta { font-size: 13px; color: var(--muted); }
      .hero { border-bottom: 1px solid var(--line); padding-bottom: 22px; margin-bottom: 30px; display: flex; justify-content: space-between; gap: 24px; }
      .focus-band { display: grid; grid-template-columns: 1.1fr .9fr; gap: 18px; margin: 18px 0 30px; }
      .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 22px 0 30px; }
      .summary-card { border: 1px solid var(--line); border-radius: 18px; padding: 18px; background: linear-gradient(180deg, #fff 0%, #fbfcff 100%); }
      .summary-label { font-size: 10px; text-transform: uppercase; letter-spacing: .18em; color: var(--muted); font-weight: 700; }
      .summary-value { margin-top: 10px; font-size: 30px; font-weight: 800; letter-spacing: -0.03em; }
      .summary-delta { margin-top: 8px; font-size: 12px; color: var(--brand-3); font-weight: 700; }
      .narrative-grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 18px; margin-bottom: 28px; }
      .panel { border: 1px solid var(--line); border-radius: 20px; padding: 20px; background: #fff; }
      .spotlight-card { border: 1px solid var(--line); border-radius: 20px; padding: 20px; background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%); }
      .headline { font-size: 1.45rem; font-weight: 800; margin-bottom: 14px; letter-spacing: -0.03em; line-height: 1.05; }
      ul { margin: 0; padding-left: 18px; }
      li { margin: 0 0 8px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid var(--line); padding: 12px 12px; text-align: left; vertical-align: top; }
      th { font-size: 10px; text-transform: uppercase; letter-spacing: .18em; color: var(--muted); }
      .metric-label { font-weight: 600; }
      .metric-desc { margin-top: 4px; color: var(--muted); font-size: 12px; }
      .value { font-weight: 600; }
      .delta { font-weight: 700; color: var(--brand-3); }
      .section { margin-top: 30px; }
      .section-header { display:flex; align-items:end; justify-content:space-between; gap:18px; margin-bottom: 14px; }
      .cover { background:
          radial-gradient(circle at top right, rgba(99,102,241,.22), transparent 32%),
          radial-gradient(circle at bottom left, rgba(14,165,233,.16), transparent 28%),
          linear-gradient(180deg, var(--brand-1) 0%, #111827 56%, var(--brand-2) 100%);
        color: #f8fafc; display: flex; flex-direction: column; justify-content: space-between; }
      .cover .eyebrow, .cover .meta { color: rgba(248,250,252,.78); }
      .cover h1 { color: #fff; font-size: 3.6rem; }
      .brand-lockup { display:flex; align-items:center; gap:14px; margin-bottom: 18px; }
      .brand-mark { width: 52px; height: 52px; border-radius: 16px; background: linear-gradient(180deg, #6366f1 0%, #4338ca 100%); color:#fff; display:flex; align-items:center; justify-content:center; font-size: 28px; font-weight: 800; box-shadow: 0 16px 34px rgba(67,56,202,.35); }
      .cover-grid { display: grid; grid-template-columns: 1.2fr .8fr; gap: 22px; }
      .cover-card { border: 1px solid rgba(255,255,255,.12); border-radius: 22px; padding: 20px; background: rgba(255,255,255,.05); backdrop-filter: blur(12px); }
      .page-number { margin-top: 18px; font-size: 12px; color: var(--muted); }
      @media print {
        body { background: #fff; }
        .page { padding: 22px; min-height: auto; }
      }
    </style>
  </head>
  <body>
    <div class="packet">
      <section class="page cover">
        <div>
          <div class="brand-lockup">
            <div class="brand-mark">H</div>
            <div>
              <div class="eyebrow">Haven executive standup packet</div>
              <div class="meta">Circle of Life portfolio operating system</div>
            </div>
          </div>
          <h1>${escapeHtml(packet.title)}</h1>
          <div class="meta">Week of ${escapeHtml(packet.weekOf)} · Version ${packet.version}</div>
          <div class="meta" style="margin-top:10px;">${escapeHtml(packet.subtitle)}. Designed for ownership, board review, and operational follow-through.</div>
        </div>
        <div class="cover-grid">
          <div class="cover-card">
            <div class="eyebrow">Prepared</div>
            <div style="font-size: 1.5rem; font-weight: 700;">${escapeHtml(generatedBy)}</div>
            <div class="meta">Generated ${escapeHtml(formatDateTimeDisplay(detail.snapshot.generatedAt))}</div>
          </div>
          <div class="cover-card">
            <div class="eyebrow">Published</div>
            <div style="font-size: 1.5rem; font-weight: 700;">${escapeHtml(publishedBy)}</div>
            <div class="meta">Published ${escapeHtml(formatDateTimeDisplay(detail.snapshot.publishedAt))}</div>
            <div class="meta">Confidence ${escapeHtml(detail.snapshot.confidenceBand)} · Completeness ${detail.snapshot.completenessPct.toFixed(0)}%</div>
          </div>
        </div>
      </section>

      <section class="page">
      <div class="hero">
        <div>
          <div class="eyebrow">Haven executive standup</div>
          <h1>Executive Summary</h1>
          <div class="meta">Week of ${escapeHtml(packet.weekOf)} · Status ${escapeHtml(packet.status)} · Version ${packet.version}</div>
        </div>
        <div class="meta">
          <div>Confidence: <strong>${escapeHtml(packet.confidenceBand)}</strong></div>
          <div>Completeness: <strong>${packet.completenessPct.toFixed(0)}%</strong></div>
          <div>Version: <strong>${packet.version}</strong></div>
        </div>
      </div>

      <div class="focus-band">
        <div class="panel">
          <div class="eyebrow">Primary focus</div>
          <div class="headline">${escapeHtml(packet.focusStatement)}</div>
          <div class="meta">This is the single highest-value read from the packet right now.</div>
        </div>
        ${
          packet.spotlightFacility
            ? `<div class="spotlight-card">
                <div class="eyebrow">Facility spotlight</div>
                <div class="headline">${escapeHtml(packet.spotlightFacility.facilityName)}</div>
                <div class="meta">${escapeHtml(packet.spotlightFacility.topConcern)} · Pressure ${packet.spotlightFacility.pressureScore}</div>
                <ul style="margin-top: 14px;">${packet.spotlightFacility.interventions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>`
            : ""
        }
      </div>

      ${portfolioSummary}

      <div class="narrative-grid">
        <div class="panel">
          <div class="headline">${escapeHtml(packet.narrative.headline)}</div>
          <h2>What matters now</h2>
          <ul>${narrativeBullets || "<li>No narrative insights available.</li>"}</ul>
          <h2 style="margin-top: 18px;">What changed</h2>
          <ul>${narrativeChanges || "<li>No prior published week available for comparison.</li>"}</ul>
          <h2 style="margin-top: 18px;">What to do</h2>
          <ul>${narrativeActions || "<li>No intervention recommendations.</li>"}</ul>
        </div>
        <div class="panel">
          <h2>Pressure ranking</h2>
          <table>
            <thead><tr><th>#</th><th>Facility</th><th>Top concern</th><th>Pressure</th></tr></thead>
            <tbody>${facilityRanking}</tbody>
          </table>
          <h2 style="margin-top: 18px;">Trust notes</h2>
          <ul>${narrativeQuality || "<li>No data quality warnings.</li>"}</ul>
        </div>
      </div>

      ${reviewNotesBlock || draftNotesBlock ? `<div class="narrative-grid" style="grid-template-columns: 1fr 1fr;">${reviewNotesBlock}${draftNotesBlock}</div>` : ""}
      <div class="page-number">Page 2</div>
      </section>

      <section class="page">
        <div class="hero">
          <div>
            <div class="eyebrow">Facility pressure</div>
            <h1>Facility Ranking & Actions</h1>
            <div class="meta">Who needs attention first, why, and what action should follow now.</div>
          </div>
        </div>
        <div class="panel" style="margin-bottom: 22px;">
          <h2>Facility ranking</h2>
          <table>
            <thead><tr><th>#</th><th>Facility</th><th>Top concern</th><th>Pressure</th></tr></thead>
            <tbody>${facilityRanking}</tbody>
          </table>
        </div>
        ${facilityActionPanels ? `<div class="narrative-grid" style="grid-template-columns: 1fr 1fr;">${facilityActionPanels}</div>` : ""}
        <div class="page-number">Page 3</div>
      </section>

      <section class="page">
        <div class="hero">
          <div>
            <div class="eyebrow">Workbook detail</div>
            <h1>Operating Detail</h1>
            <div class="meta">Decision-relevant section pages with only meaningful metrics promoted into the primary packet.</div>
          </div>
        </div>
        ${sectionBlocks}
        <div class="page-number">Page 4+</div>
      </section>

      <section class="page">
        <div class="hero">
          <div>
            <div class="eyebrow">Trust & methodology</div>
            <h1>Data Quality, Legend, and Methodology</h1>
            <div class="meta">Trust notes for interpreting the packet correctly.</div>
          </div>
        </div>
        <div class="narrative-grid">
          <div class="panel">
            <h2>Legend</h2>
            <ul>${legendList}</ul>
          </div>
          <div class="panel">
            <h2>Methodology</h2>
            <ul>${methodologyList}</ul>
          </div>
        </div>
        <div class="panel" style="margin-top: 18px;">
          <h2>Lineage rules</h2>
          <p>Every metric in this packet should be interpreted with its source mode, confidence band, freshness, and override state. Low-confidence or manual rows are shown intentionally rather than hidden so the owner can trust the packet’s limitations as well as its numbers.</p>
        </div>
        <div class="page-number">Appendix</div>
      </section>
      ${
        packet.comparison
          ? `<section class="page">
        <div class="hero">
          <div>
            <div class="eyebrow">Comparison appendix</div>
            <h1>Week-over-Week Movement</h1>
            <div class="meta">${escapeHtml(packet.comparison.headline)}</div>
          </div>
        </div>
        <div class="panel" style="margin-bottom: 18px;">
          <h2>Portfolio deltas</h2>
          <ul>${(packet.comparison.portfolioDeltas.length > 0 ? packet.comparison.portfolioDeltas : ["No material portfolio deltas between these weeks."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
        ${comparisonPanels ? `<div class="narrative-grid" style="grid-template-columns: 1fr 1fr;">${comparisonPanels}</div>` : ""}
        <div class="page-number">Comparison appendix</div>
      </section>`
          : ""
      }
      <section class="page">
        <div class="hero">
          <div>
            <div class="eyebrow">Workbook appendix</div>
            <h1>Full Workbook Appendix</h1>
            <div class="meta">Complete facility-by-facility section detail, including low-signal rows that are intentionally kept out of the primary executive packet.</div>
          </div>
        </div>
        ${appendixRows}
        <div class="page-number">Workbook appendix</div>
      </section>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
