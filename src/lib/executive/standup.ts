import type { SupabaseClient } from "@supabase/supabase-js";

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

export type StandupSnapshotDetail = {
  snapshot: {
    id: string;
    weekOf: string;
    status: string;
    generatedAt: string;
    publishedAt: string | null;
    completenessPct: number;
    confidenceBand: "high" | "medium" | "low";
    draftNotes: string | null;
    reviewNotes: string | null;
    publishedVersion: number;
  };
  facilities: StandupFacilityLive[];
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
  published_at: string | null;
  draft_notes: string | null;
  review_notes: string | null;
  published_version: number;
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

export async function fetchStandupSnapshotDetail(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  weekOf: string,
): Promise<StandupSnapshotDetail | null> {
  const [snapshotRes, facilitiesRes] = await Promise.all([
    supabase
      .from("exec_standup_snapshots" as never)
      .select("id, week_of, status, generated_at, published_at, completeness_pct, confidence_band, draft_notes, review_notes, published_version")
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
      publishedAt: snapshotResult.data.published_at,
      completenessPct: snapshotResult.data.completeness_pct,
      confidenceBand: snapshotResult.data.confidence_band,
      draftNotes: snapshotResult.data.draft_notes,
      reviewNotes: snapshotResult.data.review_notes,
      publishedVersion: snapshotResult.data.published_version,
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
      updated_by: input.userId,
    } as never)
    .eq("id", input.snapshotId)
    .eq("status", "draft");

  const result = res as unknown as { error: { message: string } | null };
  if (result.error) throw new Error(result.error.message);
}
