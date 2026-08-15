import type { SupabaseClient } from "@supabase/supabase-js";

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
  formatResidentOverviewVerifiedByStaffLabel,
} from "@/lib/residents/resident-overview-display-copy";
import { mapResidencyStatus, type ResidencyStatus } from "@/lib/residents/presence";
import type { Database } from "@/types/database";

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

export type ResidentOverviewDetail = {
  id: string;
  fullName: string;
  initials: string;
  preferredName: string | null;
  photoUrl: string | null;
  acuity: Acuity;
  /** Projected presence value (non-presence lifecycle values collapse to "active"). */
  status: ResidencyStatus;
  /** Raw `resident_status` enum value — gates whether presence is editable. */
  rawStatus: string | null;
  fallRiskRaw: string | null;
  roomLabel: string;
  unitName: string;
  admissionLabel: string;
  dobLabel: string;
  ageYears: number | null;
  gender: string | null;
  diagnosisRawList: string[];
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
  specialistConsultActiveCount: number;
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
    loggedByLabel: string;
  }>;
  recentAdl: Array<{
    id: string;
    logTimeLabel: string;
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
    shift: string;
    loggedByLabel: string;
    nurseNotified: boolean;
  }>;
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
  bed_by_id: SupabaseBedJoin | null;
  beds: SupabaseBedJoin[] | null;
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

function mapAcuity(value: string | null): Acuity {
  if (value === "level_3") return 3;
  if (value === "level_2") return 2;
  return 1;
}

function truncateSnippet(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatLogTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
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

function formatDob(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(parsed);
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
  return BEHAVIOR_TYPE_LABELS[value] ?? value.replace(/_/g, " ");
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
  return CONDITION_TYPE_LABELS[value] ?? value.replace(/_/g, " ");
}

export async function loadResidentOverviewDetail(
  residentId: string,
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<ResidentOverviewDetail | null> {
  if (!UUID_STRING_RE.test(residentId)) return null;

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
    : "No bed link";
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
  ] = await Promise.all([
    supabase
      .from("daily_logs")
      .select("id, log_date, shift, general_notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("log_date", { ascending: false })
      .limit(8),
    supabase
      .from("adl_logs")
      .select("id, log_time, log_date, shift, adl_type, assistance_level, refused, notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("log_time", { ascending: false })
      .limit(12),
    supabase
      .from("behavioral_logs")
      .select("id, occurred_at, shift, behavior_type, behavior, injury_occurred, notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(10),
    supabase
      .from("condition_changes")
      .select("id, reported_at, shift, change_type, description, severity, nurse_notified, reported_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("reported_at", { ascending: false })
      .limit(10),
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

  const specialistConsultActiveCount =
    specialistCountResult.error ? 0 : specialistCountResult.count ?? 0;

  const profileUserIds = [
    ...new Set([
      resident.code_status_verified_by,
      resident.allergy_list_reviewed_by,
      resident.primary_diagnosis_reviewed_by,
      ...dailyRows.map((r) => r.logged_by),
      ...adlRows.map((r) => r.logged_by),
      ...behaviorRows.map((r) => r.logged_by),
      ...conditionRows.map((r) => r.reported_by),
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
    snippet: truncateSnippet(r.general_notes?.trim() || "—", 360),
    loggedByLabel: nameById.get(r.logged_by) ?? "Staff",
  }));

  const recentAdl = adlRows.map((r) => {
    const base = `${adlTypeLabel(r.adl_type)} · ${assistanceLabel(r.assistance_level)}`;
    const summary = r.refused ? `${base} · refused` : base;
    return {
      id: r.id,
      logTimeLabel: formatLogTime(r.log_time),
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
    shift: r.shift,
    loggedByLabel: nameById.get(r.reported_by) ?? "Staff",
    nurseNotified: r.nurse_notified,
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

  const contactsView = contactsViewFromTable.length > 0 ? contactsViewFromTable : legacyContacts;

  return {
    id: resident.id,
    fullName,
    initials,
    preferredName: resident.preferred_name,
    photoUrl: resident.photo_url,
    acuity,
    status,
    rawStatus: resident.status,
    fallRiskRaw: resident.fall_risk_level,
    roomLabel,
    unitName: unitName.length > 0 ? unitName : "No unit linked",
    admissionLabel: formatResidentOverviewAdmissionLabel(resident.admission_date),
    dobLabel: formatDob(resident.date_of_birth),
    ageYears: computeAgeYears(resident.date_of_birth),
    gender: resident.gender,
    diagnosisRawList,
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
  };
}
