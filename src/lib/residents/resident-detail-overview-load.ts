import { formatShortDateTime } from "@/lib/format/datetime";
import type { SupabaseClient } from "@supabase/supabase-js";

import { headCountOrNull } from "@/lib/metrics/require-head-count";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { throwIfQueryError } from "@/lib/supabase/query-error";
import { adlTypeLabel, assistanceLabel } from "@/lib/caregiver/adl-form-options";
import {
  carePlanAnnualReviewDeltaDays,
} from "@/lib/residents/care-plan-annual-review-window";
import { formatLoadResidentsFullName } from "@/lib/residents/load-residents-display-copy";
import {
  formatResidentOverviewAdmissionLabel,
  formatResidentOverviewDailyNoteSnippet,
  formatResidentOverviewDobLabel,
  formatResidentOverviewVerifiedByStaffLabel,
} from "@/lib/residents/resident-overview-display-copy";
import { mapResidencyStatus, type ResidencyStatus } from "@/lib/residents/presence";
import { parseDocumentedAcuityLevel } from "@/lib/residents/resident-acuity-display";
import {
  ACTIVITY_FEED_ROW_CAP,
  ACTIVITY_FEED_WINDOW_DAYS,
  activityFeedQueryBounds,
  type ActivityFeedKind,
  type ActivityFeedPeriodDays,
} from "@/lib/residents/resident-activity-feed";
import { PRESENCE_HISTORY_LIMIT } from "@/lib/residents/resident-presence-history";
import {
  parseResidentRecordFieldStates,
  type ResidentRecordFieldStates,
} from "@/lib/residents/resident-record-edit";
import { responsiblePartyContact } from "@/lib/residents/resident-responsible-party";
import { RESIDENT_NO_BED_COPY, RESIDENT_NO_UNIT_COPY } from "@/lib/residents/roster-display-copy";
import type { Database } from "@/types/database";
import { enumLabel } from "@/lib/display/enum-label";

export type Acuity = 1 | 2 | 3;
export type { ResidencyStatus };

export type ConditionEventContent = {
  id: string;
  typeLabel: string;
  severity: string;
  description: string;
  loggedByLabel: string;
  nurseNotified: boolean;
};

export type BehaviorEventContent = {
  id: string;
  typeLabel: string;
  behaviorText: string;
  loggedByLabel: string;
  injuryOccurred: boolean;
};

export type ADLEventContent = {
  id: string;
  summary: string;
  loggedByLabel: string;
};

export type ResidentContactRowView = {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  isEmergencyContact: boolean;
  isHealthcareProxy: boolean;
  isPowerOfAttorney: boolean;
  sortOrder: number;
  updatedAt: string | null;
};

/** One row of `resident_status_history`, as the record shows it. */
export type ResidentPresenceHistoryEntry = {
  id: string;
  /** Raw `resident_status` value for the span. */
  status: string;
  effectiveFrom: string;
  /** Null for the open (current) span. */
  effectiveTo: string | null;
  /** Who recorded the change; null when the history row carries no actor. */
  recordedByName: string | null;
  reason: string | null;
};

export type ResidentOverviewDetail = {
  id: string;
  fullName: string;
  initials: string;
  preferredName: string | null;
  photoUrl: string | null;
  /** Sort/threshold level; read `acuityLevel` to tell "not recorded" from level 1. */
  acuity: Acuity;
  /** Raw `residents.acuity_level` — null when no acuity assessment is recorded. */
  acuityLevel: string | null;
  /** Projected presence value (non-presence lifecycle values collapse to "active"). */
  status: ResidencyStatus;
  /** Raw `resident_status` enum value — gates whether presence is editable. */
  rawStatus: string | null;
  fallRiskRaw: string | null;
  roomLabel: string;
  unitName: string;
  /** `facilities.name` for the resident's facility; null when the facility row is unreadable. */
  facilityName: string | null;
  /**
   * `residents.facility_id`. Needed by any action on this record that reads
   * facility configuration: a Monitoring Order's interval presets come from
   * `public.monitoring_order_interval_options`, which takes a facility since
   * migration 432.
   */
  facilityId: string;
  admissionLabel: string;
  dobLabel: string;
  ageYears: number | null;
  gender: string | null;
  diagnosisRawList: string[];
  /** `residents.primary_diagnosis` verbatim (may be a combined list for imported residents). */
  primaryDiagnosisRaw: string | null;
  /** `residents.diagnosis_list` verbatim. */
  diagnosisListRaw: string[];
  allergiesTokens: string[];
  dietOrder: string | null;
  codeStatusRaw: string | null;
  primaryPayer: string | null;
  hospiceStatus: string | null;
  advanceDirectiveType: string | null;
  advanceDirectiveOnFile: boolean;
  responsiblePartyName: string | null;
  responsiblePartyRelationship: string | null;
  responsiblePartyPhone: string | null;
  responsiblePartyEmail: string | null;
  primaryPhysicianName: string | null;
  primaryPhysicianPhone: string | null;
  codeStatusVerifiedAt: string | null;
  codeStatusVerifiedByName: string | null;
  allergyReviewedAt: string | null;
  allergyReviewedByName: string | null;
  diagnosesReviewedAt: string | null;
  diagnosesReviewedByName: string | null;
  carePlanVersion: number | null;
  carePlanEffectiveDate: string | null;
  carePlanAnnualDeltaDays: number | null;
  polstMolstRawStatus: string | null;
  /** Null when the count could not be read (COL-649) — not "0 on file". */
  specialistConsultActiveCount: number | null;
  assessmentsUpcomingJson: Array<{
    assessmentType: string;
    nextDue: string | null;
    assessedAt: string;
  }>;
  contacts: ResidentContactRowView[];
  recentDailyNotes: Array<{
    id: string;
    logDate: string;
    shift: string;
    snippet: string;
    /** True when the daily log carries general note text. */
    hasNote: boolean;
    loggedByLabel: string;
  }>;
  recentAdl: Array<{
    id: string;
    logTimeLabel: string;
    /** Raw `adl_logs.log_time` for period filtering. */
    logTimeIso: string;
    logDate: string;
    shift: string;
    summary: string;
    detailNote: string | null;
    loggedByLabel: string;
  }>;
  recentBehavior: Array<{
    id: string;
    typeLabel: string;
    behaviorText: string;
    occurredLabel: string;
    /** Raw `behavioral_logs.occurred_at` for period filtering. */
    occurredAtIso: string;
    shift: string;
    loggedByLabel: string;
    injuryOccurred: boolean;
    notesSnippet: string | null;
  }>;
  recentConditionChanges: Array<{
    id: string;
    typeLabel: string;
    severity: string;
    description: string;
    reportedLabel: string;
    /** Raw `condition_changes.reported_at` for period filtering. */
    reportedAtIso: string;
    shift: string;
    loggedByLabel: string;
    nurseNotified: boolean;
  }>;
  /** The period the activity rows above were read for. */
  activityDays: ActivityFeedPeriodDays;
  /** Kinds that reached `ACTIVITY_FEED_ROW_CAP` for the period, so the feed can say it is clipped. */
  activityTruncatedKinds: ActivityFeedKind[];
  /**
   * COL-599: presence says what, and now since when and who. Newest first; the
   * open span (effectiveTo null) is the current presence. Empty when the
   * history table has no row for the resident — the record then says so rather
   * than inventing a date.
   */
  presenceHistory: ResidentPresenceHistoryEntry[];
  /**
   * COL-599: the Form 1823 the record is working from — the `is_current` row,
   * else the newest by exam date. `undefined` when `form_1823_records` could
   * not be read, so the record never claims "none on file" on a failed read.
   */
  form1823?: ResidentForm1823Clock | null;
  /** COL-599: incident follow-ups on this resident that are not completed, soonest first. */
  openIncidentFollowups: ResidentIncidentFollowupClock[];
  /**
   * COL-597: `residents.updated_at` exactly as PostgREST returned it — the
   * version an in-place edit must match. Kept as the string: a JS Date would
   * drop the microseconds and every save would read as a conflict.
   */
  updatedAt?: string | null;
  /** COL-597: Do Not Hospitalize; null = not recorded. */
  doNotHospitalize?: boolean | null;
  /** COL-597: feeding tube type (`none` = recorded as no tube); null = not recorded. */
  feedingTube?: string | null;
  feedingTubeNotes?: string | null;
  /**
   * COL-597: per field, whether the signed-in person may record it here and
   * where the current value came from. Null when unavailable — the record then
   * offers no editor rather than one that will be refused.
   */
  fieldStates?: ResidentRecordFieldStates | null;
};

export type ResidentForm1823Clock = {
  id: string;
  /** `form_1823_status`: pending | received | expired | renewal_due. */
  status: string;
  examDate: string | null;
  expirationDate: string | null;
};

export type ResidentIncidentFollowupClock = {
  id: string;
  incidentId: string;
  taskType: string;
  description: string;
  dueAt: string;
};

/** Most open follow-ups the overview reads. A page-weight budget. */
export const OPEN_FOLLOWUP_LIMIT = 20;

export type LoadResidentOverviewOptions = {
  /** Activity period in facility days; defaults to `ACTIVITY_FEED_WINDOW_DAYS`. */
  activityDays?: ActivityFeedPeriodDays;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

type SupabaseResidentRow = {
  id: string;
  facility_id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  status: string | null;
  acuity_level: string | null;
  bed_id: string | null;
  photo_url: string | null;
  primary_diagnosis: string | null;
  diagnosis_list: string[] | null;
  allergy_list: string[] | null;
  diet_order: string | null;
  code_status: string | null;
  fall_risk_level: string | null;
  hospice_status: string | null;
  advance_directive_type: string | null;
  advance_directive_on_file: boolean | null;
  primary_payer: string | null;
  primary_physician_name: string | null;
  primary_physician_phone: string | null;
  responsible_party_name: string | null;
  responsible_party_relationship: string | null;
  responsible_party_phone: string | null;
  responsible_party_email: string | null;
  emergency_contact_1_name: string | null;
  emergency_contact_1_relationship: string | null;
  emergency_contact_1_phone: string | null;
  emergency_contact_2_name: string | null;
  emergency_contact_2_relationship: string | null;
  emergency_contact_2_phone: string | null;
  admission_date: string | null;
  code_status_verified_at: string | null;
  code_status_verified_by: string | null;
  allergy_list_reviewed_at: string | null;
  allergy_list_reviewed_by: string | null;
  primary_diagnosis_reviewed_at: string | null;
  primary_diagnosis_reviewed_by: string | null;
  updated_at: string | null;
  do_not_hospitalize: boolean | null;
  feeding_tube: string | null;
  feeding_tube_notes: string | null;
  bed_by_id: SupabaseBedJoin | null;
  beds: SupabaseBedJoin[] | null;
};

type PresenceHistoryRow = {
  id: string;
  status: string;
  effective_from: string;
  effective_to: string | null;
  reason: string | null;
  created_by: string | null;
  updated_by: string | null;
};

type Form1823Row = {
  id: string;
  status: string;
  exam_date: string | null;
  expiration_date: string | null;
  is_current: boolean | null;
};

type SupabaseUnitJoin = {
  id: string;
  name: string | null;
};

type SupabaseRoomJoin = {
  id: string;
  room_number: string | null;
  unit_id: string | null;
  units: SupabaseUnitJoin | null;
};

type SupabaseBedJoin = {
  id: string;
  bed_label: string | null;
  room_id: string | null;
  rooms: SupabaseRoomJoin | null;
};

/** Sort/threshold level only; the UI reads `acuityLevel` so a missing assessment is never shown as level 1. */
function mapAcuity(value: string | null): Acuity {
  return parseDocumentedAcuityLevel(value) ?? 1;
}

function truncateSnippet(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatLogTime(iso: string): string {
  return formatShortDateTime(iso, { fallback: iso });
}

function computeAgeYears(dateOfBirth: string | null, now: Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T12:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

const BEHAVIOR_TYPE_LABELS: Record<string, string> = {
  agitation: "Agitation / anxiety",
  wandering: "Wandering / elopement risk",
  verbal: "Verbal outburst",
  physical: "Physical aggression",
  self_injury: "Self-injury / SIB",
  withdrawal: "Withdrawal / refusal",
  sundowning: "Sundowning",
  other: "Other",
};

function behaviorTypeLabel(value: string): string {
  return BEHAVIOR_TYPE_LABELS[value] ?? enumLabel(value);
}

const CONDITION_TYPE_LABELS: Record<string, string> = {
  vitals: "Vitals / measurements",
  pain: "Pain",
  respiratory: "Respiratory",
  skin_wound: "Skin / wound",
  mental_status: "Mental status / cognition",
  gi: "GI / appetite",
  urinary: "Urinary",
  neurologic: "Neurologic",
  other: "Other",
};

function conditionChangeTypeLabel(value: string): string {
  return CONDITION_TYPE_LABELS[value] ?? enumLabel(value);
}

export async function loadResidentOverviewDetail(
  residentId: string,
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
  options: LoadResidentOverviewOptions = {},
): Promise<ResidentOverviewDetail | null> {
  if (!UUID_STRING_RE.test(residentId)) return null;
  const activityDays = options.activityDays ?? ACTIVITY_FEED_WINDOW_DAYS;
  // COL-599: the activity reads are bounded by the period, not by a row count.
  // They used to take the newest 8–12 rows of each kind, so even the fixed
  // 30-day window could be silently short on a busy record.
  const activityBounds = activityFeedQueryBounds(activityDays);

  const residentCols = [
    "id",
    "facility_id",
    "first_name",
    "middle_name",
    "last_name",
    "preferred_name",
    "date_of_birth",
    "gender",
    "status",
    "acuity_level",
    "bed_id",
    "photo_url",
    "primary_diagnosis",
    "diagnosis_list",
    "allergy_list",
    "diet_order",
    "code_status",
    "fall_risk_level",
    "hospice_status",
    "advance_directive_type",
    "advance_directive_on_file",
    "primary_physician_name",
    "primary_physician_phone",
    "primary_payer",
    "responsible_party_name",
    "responsible_party_relationship",
    "responsible_party_phone",
    "responsible_party_email",
    "emergency_contact_1_name",
    "emergency_contact_1_relationship",
    "emergency_contact_1_phone",
    "emergency_contact_2_name",
    "emergency_contact_2_relationship",
    "emergency_contact_2_phone",
    "admission_date",
    "code_status_verified_at",
    "code_status_verified_by",
    "allergy_list_reviewed_at",
    "allergy_list_reviewed_by",
    "primary_diagnosis_reviewed_at",
    "primary_diagnosis_reviewed_by",
    "updated_at",
    "do_not_hospitalize",
    "feeding_tube",
    "feeding_tube_notes",
    "bed_by_id: beds!residents_bed_id_fkey ( id, bed_label, room_id, rooms ( id, room_number, unit_id, units ( id, name ) ) )",
    "beds!fk_beds_resident ( id, bed_label, room_id, rooms ( id, room_number, unit_id, units ( id, name ) ) )",
  ].join(",");

  const residentResult = (await supabase
    .from("residents" as never)
    .select(residentCols)
    .eq("id", residentId)
    .is("deleted_at", null)
    .maybeSingle()) as unknown as QueryResult<SupabaseResidentRow>;

  throwIfQueryError(residentResult.error, "residents profile");
  const resident = residentResult.data;
  if (!resident) return null;

  if (isValidFacilityIdForQuery(selectedFacilityId) && resident.facility_id !== selectedFacilityId) {
    return null;
  }

  const bed = resident.bed_by_id ?? resident.beds?.[0] ?? null;
  const room = bed?.rooms ?? null;
  const unit = room?.units ?? null;

  const firstName = resident.first_name ?? "";
  const lastName = resident.last_name ?? "";
  const fullName = formatLoadResidentsFullName(firstName, lastName);
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "NA";
  const acuity = mapAcuity(resident.acuity_level);
  const status = mapResidencyStatus(resident.status);

  const roomLabel = room?.room_number
    ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}`
    : RESIDENT_NO_BED_COPY;
  const unitName = unit?.name?.trim() ?? "";

  const facilityId = resident.facility_id;

  const [
    dailyResult,
    adlResult,
    behaviorResult,
    conditionResult,
    carePlansResult,
    contactsResult,
    directiveDocsResult,
    assessmentsResult,
    specialistCountResult,
    facilityResult,
    presenceHistoryResult,
    form1823Result,
    followupResult,
    fieldStatesResult,
  ] = await Promise.all([
    // The feed shows daily logs only when they carry a general note, and ADL
    // entries only when refused — so read exactly those, not the newest rows
    // of every kind and then discard most of them.
    supabase
      .from("daily_logs")
      .select("id, log_date, shift, general_notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .not("general_notes", "is", null)
      .gte("log_date", activityBounds.sinceDay)
      .order("log_date", { ascending: false })
      .limit(ACTIVITY_FEED_ROW_CAP),
    supabase
      .from("adl_logs")
      .select("id, log_time, log_date, shift, adl_type, assistance_level, refused, notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .eq("refused", true)
      .gte("log_time", activityBounds.sinceIso)
      .order("log_time", { ascending: false })
      .limit(ACTIVITY_FEED_ROW_CAP),
    supabase
      .from("behavioral_logs")
      .select("id, occurred_at, shift, behavior_type, behavior, injury_occurred, notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .gte("occurred_at", activityBounds.sinceIso)
      .order("occurred_at", { ascending: false })
      .limit(ACTIVITY_FEED_ROW_CAP),
    supabase
      .from("condition_changes")
      .select("id, reported_at, shift, change_type, description, severity, nurse_notified, reported_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .gte("reported_at", activityBounds.sinceIso)
      .order("reported_at", { ascending: false })
      .limit(ACTIVITY_FEED_ROW_CAP),
    supabase
      .from("care_plans")
      .select("version, effective_date, status")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .in("status", ["active", "under_review"])
      .order("effective_date", { ascending: false })
      .limit(1),
    supabase
      .from("resident_contacts")
      .select(
        "id, name, relationship, phone, is_emergency_contact, is_healthcare_proxy, is_power_of_attorney, sort_order, updated_at",
      )
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("advance_directive_documents" as never)
      .select("polst_status")
      .eq("resident_id", residentId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("assessments")
      .select("assessment_type, next_due_date, assessment_date")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("next_due_date", { ascending: true }),
    supabase
      .from("assessments")
      .select("id", { count: "exact", head: true })
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .ilike("assessment_type", "%consult%"),
    supabase.from("facilities").select("name").eq("id", facilityId).maybeSingle(),
    supabase
      .from("resident_status_history" as never)
      .select("id, status, effective_from, effective_to, reason, created_by, updated_by")
      .eq("resident_id", residentId)
      .is("deleted_at", null)
      .order("effective_from", { ascending: false })
      .limit(PRESENCE_HISTORY_LIMIT) as unknown as Promise<QueryResult<PresenceHistoryRow[]>>,
    supabase
      .from("form_1823_records" as never)
      .select("id, status, exam_date, expiration_date, is_current")
      .eq("resident_id", residentId)
      .is("deleted_at", null)
      .order("exam_date", { ascending: false, nullsFirst: false })
      .limit(10) as unknown as Promise<QueryResult<Form1823Row[]>>,
    supabase
      .from("incident_followups")
      .select("id, incident_id, task_type, description, due_at")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("completed_at", null)
      .is("deleted_at", null)
      .order("due_at", { ascending: true })
      .limit(OPEN_FOLLOWUP_LIMIT),
    supabase.rpc("resident_record_field_sources" as never, { p_resident_id: residentId } as never) as unknown as Promise<
      QueryResult<unknown>
    >,
  ]);

  if (
    dailyResult.error ||
    adlResult.error ||
    behaviorResult.error ||
    conditionResult.error ||
    carePlansResult.error ||
    contactsResult.error ||
    assessmentsResult.error
  ) {
    throw new Error(
      dailyResult.error?.message ??
        adlResult.error?.message ??
        behaviorResult.error?.message ??
        conditionResult.error?.message ??
        carePlansResult.error?.message ??
        contactsResult.error?.message ??
        assessmentsResult.error?.message ??
        "Resident aggregation failed.",
    );
  }

  const dailyRows = dailyResult.data ?? [];
  const adlRows = adlResult.data ?? [];
  const behaviorRows = behaviorResult.data ?? [];
  const conditionRows = conditionResult.data ?? [];
  const carePlanRows = carePlansResult.data ?? [];
  const contactRowsRaw = contactsResult.data ?? [];

  let polstMolstRawStatus: string | null = null;
  const directiveRowUnknown = directiveDocsResult.data as Record<string, unknown>[] | null;
  if (
    directiveDocsResult &&
    !directiveDocsResult.error &&
    directiveRowUnknown &&
    directiveRowUnknown[0]?.polst_status
  ) {
    polstMolstRawStatus = String(directiveRowUnknown[0].polst_status);
  }

  // Presence history is supporting context: an unreadable history leaves the
  // record saying "not recorded", it does not take the whole page down.
  const presenceRows = presenceHistoryResult.error ? [] : (presenceHistoryResult.data ?? []);

  const form1823Rows = form1823Result.error ? null : (form1823Result.data ?? []);
  const form1823Row = form1823Rows ? (form1823Rows.find((r) => r.is_current) ?? form1823Rows[0] ?? null) : undefined;
  const form1823: ResidentForm1823Clock | null | undefined =
    form1823Row === undefined
      ? undefined
      : form1823Row === null
        ? null
        : {
            id: form1823Row.id,
            status: form1823Row.status,
            examDate: form1823Row.exam_date,
            expirationDate: form1823Row.expiration_date,
          };
  const openIncidentFollowups: ResidentIncidentFollowupClock[] = followupResult.error
    ? []
    : (followupResult.data ?? []).map((r) => ({
        id: r.id,
        incidentId: r.incident_id,
        taskType: r.task_type,
        description: r.description,
        dueAt: r.due_at,
      }));

  const specialistConsultActiveCount = headCountOrNull(specialistCountResult);

  const profileUserIds = [
    ...new Set([
      resident.code_status_verified_by,
      resident.allergy_list_reviewed_by,
      resident.primary_diagnosis_reviewed_by,
      ...dailyRows.map((r) => r.logged_by),
      ...adlRows.map((r) => r.logged_by),
      ...behaviorRows.map((r) => r.logged_by),
      ...conditionRows.map((r) => r.reported_by),
      ...presenceRows.map((r) => r.created_by),
    ]),
  ].filter((x): x is string => typeof x === "string" && UUID_STRING_RE.test(x));

  const nameById = new Map<string, string>();
  if (profileUserIds.length > 0) {
    const profResult = await supabase.from("user_profiles").select("id, full_name").in("id", profileUserIds);
    throwIfQueryError(profResult.error, "user_profiles");
    for (const p of profResult.data ?? []) {
      nameById.set(p.id, p.full_name);
    }
  }

  const recentDailyNotes = dailyRows.map((r) => ({
    id: r.id,
    logDate: r.log_date,
    shift: r.shift,
    snippet: truncateSnippet(formatResidentOverviewDailyNoteSnippet(r.general_notes), 360),
    hasNote: Boolean(r.general_notes?.trim()),
    loggedByLabel: nameById.get(r.logged_by) ?? "Staff",
  }));

  const recentAdl = adlRows.map((r) => {
    const base = `${adlTypeLabel(r.adl_type)} · ${assistanceLabel(r.assistance_level)}`;
    const summary = r.refused ? `${base} · refused` : base;
    return {
      id: r.id,
      logTimeLabel: formatLogTime(r.log_time),
      logTimeIso: r.log_time,
      logDate: r.log_date,
      shift: r.shift,
      summary,
      detailNote: r.notes?.trim() ? truncateSnippet(r.notes.trim(), 240) : null,
      loggedByLabel: nameById.get(r.logged_by) ?? "Staff",
    };
  });

  const recentBehavior = behaviorRows.map((r) => ({
    id: r.id,
    typeLabel: behaviorTypeLabel(r.behavior_type),
    behaviorText: r.behavior,
    occurredLabel: formatLogTime(r.occurred_at),
    occurredAtIso: r.occurred_at,
    shift: r.shift,
    loggedByLabel: nameById.get(r.logged_by) ?? "Staff",
    injuryOccurred: r.injury_occurred,
    notesSnippet: r.notes?.trim() ? truncateSnippet(r.notes.trim(), 200) : null,
  }));

  const recentConditionChanges = conditionRows.map((r) => ({
    id: r.id,
    typeLabel: conditionChangeTypeLabel(r.change_type),
    severity: r.severity,
    description: r.description,
    reportedLabel: formatLogTime(r.reported_at),
    reportedAtIso: r.reported_at,
    shift: r.shift,
    loggedByLabel: nameById.get(r.reported_by) ?? "Staff",
    nurseNotified: r.nurse_notified,
  }));

  const activityTruncatedKinds: ActivityFeedKind[] = [];
  if (conditionRows.length >= ACTIVITY_FEED_ROW_CAP) activityTruncatedKinds.push("condition");
  if (behaviorRows.length >= ACTIVITY_FEED_ROW_CAP) activityTruncatedKinds.push("behavior");
  if (adlRows.length >= ACTIVITY_FEED_ROW_CAP) activityTruncatedKinds.push("adl");
  if (dailyRows.length >= ACTIVITY_FEED_ROW_CAP) activityTruncatedKinds.push("note");

  // The row that opened a span was written by whoever changed the status
  // (`fn_resident_status_history_capture` sets created_by to the actor);
  // updated_by on a closed span is whoever closed it, i.e. the next change.
  const presenceHistory: ResidentPresenceHistoryEntry[] = presenceRows.map((r) => ({
    id: r.id,
    status: r.status,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    recordedByName: r.created_by ? (nameById.get(r.created_by) ?? null) : null,
    reason: r.reason?.trim() || null,
  }));

  const activePlan = carePlanRows[0] ?? null;
  const careAnnualDelta =
    activePlan?.effective_date != null
      ? carePlanAnnualReviewDeltaDays(activePlan.effective_date as string)
      : null;

  const primaryDx = resident.primary_diagnosis?.trim() ?? "";
  const secondaries = (resident.diagnosis_list ?? []).map((x) => x.trim()).filter(Boolean);
  const diagnosisRawList = Array.from(
    new Map(
      [primaryDx, ...secondaries].filter(Boolean).map((d) => [d.toLowerCase(), d] as const),
    ).values(),
  );

  const allergiesTokens =
    resident.allergy_list?.map((x) => x.trim()).filter(Boolean) ??
    ([] as string[]); /* empty ⇒ NKDA heuristic in UI */

  const contactsViewFromTable: ResidentContactRowView[] = contactRowsRaw.map((c: Record<string, unknown>) => ({
    id: String(c.id),
    name: String(c.name ?? ""),
    relationship: (c.relationship as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    isEmergencyContact: Boolean(c.is_emergency_contact),
    isHealthcareProxy: Boolean(c.is_healthcare_proxy),
    isPowerOfAttorney: Boolean(c.is_power_of_attorney),
    sortOrder: Number(c.sort_order ?? 0),
    updatedAt: (c.updated_at as string | null) ?? null,
  }));

  const legacyContacts: ResidentContactRowView[] = [];
  if (contactsViewFromTable.length === 0) {
    if (resident.emergency_contact_1_name?.trim()) {
      legacyContacts.push({
        id: "legacy-emergency-contact-1",
        name: resident.emergency_contact_1_name.trim(),
        relationship: resident.emergency_contact_1_relationship,
        phone: resident.emergency_contact_1_phone,
        isEmergencyContact: true,
        isHealthcareProxy: false,
        isPowerOfAttorney: false,
        sortOrder: 1,
        updatedAt: null,
      });
    }
    if (resident.emergency_contact_2_name?.trim()) {
      legacyContacts.push({
        id: "legacy-emergency-contact-2",
        name: resident.emergency_contact_2_name.trim(),
        relationship: resident.emergency_contact_2_relationship,
        phone: resident.emergency_contact_2_phone,
        isEmergencyContact: true,
        isHealthcareProxy: false,
        isPowerOfAttorney: false,
        sortOrder: 2,
        updatedAt: null,
      });
    }
  }

  // COL-599: the last rung. A record can carry a responsible party in its own
  // columns and no emergency contact at all — four fields this loader already
  // reads and the card never showed, so the resident read as having nobody.
  // A maintained contact row, then a legacy emergency contact, then this.
  const responsibleParty =
    contactsViewFromTable.length === 0 && legacyContacts.length === 0
      ? responsiblePartyContact({
          responsiblePartyName: resident.responsible_party_name,
          responsiblePartyRelationship: resident.responsible_party_relationship,
          responsiblePartyPhone: resident.responsible_party_phone,
          responsiblePartyEmail: resident.responsible_party_email,
        })
      : null;

  const contactsView =
    contactsViewFromTable.length > 0
      ? contactsViewFromTable
      : legacyContacts.length > 0
        ? legacyContacts
        : responsibleParty
          ? [responsibleParty.row]
          : [];

  return {
    id: resident.id,
    fullName,
    initials,
    preferredName: resident.preferred_name,
    photoUrl: resident.photo_url,
    acuity,
    acuityLevel: resident.acuity_level,
    status,
    rawStatus: resident.status,
    fallRiskRaw: resident.fall_risk_level,
    roomLabel,
    unitName: unitName.length > 0 ? unitName : RESIDENT_NO_UNIT_COPY,
    facilityName: facilityResult.data?.name?.trim() || null,
    facilityId,
    admissionLabel: formatResidentOverviewAdmissionLabel(resident.admission_date),
    dobLabel: formatResidentOverviewDobLabel(resident.date_of_birth),
    ageYears: computeAgeYears(resident.date_of_birth),
    gender: resident.gender,
    diagnosisRawList,
    primaryDiagnosisRaw: resident.primary_diagnosis?.trim() || null,
    diagnosisListRaw: secondaries,
    allergiesTokens,
    dietOrder: resident.diet_order,
    codeStatusRaw: resident.code_status ?? null,
    primaryPayer: resident.primary_payer,
    hospiceStatus: resident.hospice_status ?? null,
    advanceDirectiveOnFile: Boolean(resident.advance_directive_on_file),
    advanceDirectiveType: resident.advance_directive_type,
    responsiblePartyName: resident.responsible_party_name,
    responsiblePartyRelationship: resident.responsible_party_relationship,
    responsiblePartyPhone: resident.responsible_party_phone,
    responsiblePartyEmail: resident.responsible_party_email,
    primaryPhysicianName: resident.primary_physician_name,
    primaryPhysicianPhone: resident.primary_physician_phone,
    codeStatusVerifiedAt: resident.code_status_verified_at,
    codeStatusVerifiedByName: formatResidentOverviewVerifiedByStaffLabel(
      resident.code_status_verified_by,
      nameById.get(resident.code_status_verified_by ?? ""),
    ),
    allergyReviewedAt: resident.allergy_list_reviewed_at,
    allergyReviewedByName: formatResidentOverviewVerifiedByStaffLabel(
      resident.allergy_list_reviewed_by,
      nameById.get(resident.allergy_list_reviewed_by ?? ""),
    ),
    diagnosesReviewedAt: resident.primary_diagnosis_reviewed_at,
    diagnosesReviewedByName: formatResidentOverviewVerifiedByStaffLabel(
      resident.primary_diagnosis_reviewed_by,
      nameById.get(resident.primary_diagnosis_reviewed_by ?? ""),
    ),
    carePlanVersion: activePlan?.version ?? null,
    carePlanEffectiveDate: activePlan?.effective_date ?? null,
    carePlanAnnualDeltaDays: careAnnualDelta,
    polstMolstRawStatus,
    specialistConsultActiveCount,
    assessmentsUpcomingJson: (assessmentsResult.data ?? []).map((row) => ({
      assessmentType: String(row.assessment_type ?? ""),
      nextDue: (row.next_due_date as string | null) ?? null,
      assessedAt: row.assessment_date as string,
    })),
    contacts: contactsView,
    recentDailyNotes,
    recentAdl,
    recentBehavior,
    recentConditionChanges,
    activityDays,
    activityTruncatedKinds,
    presenceHistory,
    form1823,
    openIncidentFollowups,
    updatedAt: resident.updated_at,
    doNotHospitalize: resident.do_not_hospitalize,
    feedingTube: resident.feeding_tube,
    feedingTubeNotes: resident.feeding_tube_notes,
    fieldStates: fieldStatesResult.error ? null : parseResidentRecordFieldStates(fieldStatesResult.data),
  };
}
