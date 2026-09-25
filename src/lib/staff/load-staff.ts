import { ASSIGNMENT_SNAPSHOT_SELECT, type AssignmentSnapshot } from "@/lib/schedules/assignment-context";
import type { SupabaseClient } from "@supabase/supabase-js";

import { enumLabel } from "@/lib/display/enum-label";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { evaluateStaffCertifications, type CertificationStatus } from "@/lib/staff/certification-aggregate";
import { certificationPolicyResolver, loadCertificationRules } from "@/lib/staff/certification-policy";
import { formatStaffRosterNextShift } from "@/lib/staff/staff-roster-display-copy";
import type { Database } from "@/types/database";

export type { CertificationStatus };

export type StaffRole = "nurse" | "caregiver" | "med_tech" | "admin";
export type StaffStatus = "active" | "on_leave" | "inactive";

export type StaffRow = {
  id: string;
  name: string;
  initials: string;
  role: StaffRole;
  roleLabel: string;
  status: StaffStatus;
  certifications: CertificationStatus;
  /** Whether any certification requirement is recorded for this person's building (COL-709). */
  certRequirementsSetUp: boolean;
  nextShift: string;
  photoUrl?: string | null;
  /** The building this employment record belongs to; one person can hold a record at several. */
  facilityId?: string;
  /** Linked login, when the record has one — the only identity shared across a person's records. */
  userId?: string | null;
};

/**
 * People, not employment records: records linked to the same login are one
 * person; an unlinked record counts on its own (never matched by name or email).
 */
export function countDistinctStaffPeople(rows: Pick<StaffRow, "id" | "userId">[]): number {
  return new Set(rows.map((row) => (row.userId ? `user:${row.userId}` : `staff:${row.id}`))).size;
}

type SupabaseStaffRow = {
  id: string;
  facility_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  staff_role: string;
  employment_status: string;
  photo_url: string | null;
  updated_at: string;
  deleted_at: string | null;
};

export type StaffDirectorySourceRow = Pick<
  SupabaseStaffRow,
  | "id"
  | "facility_id"
  | "user_id"
  | "first_name"
  | "last_name"
  | "email"
  | "staff_role"
  | "employment_status"
  | "photo_url"
  | "updated_at"
  | "deleted_at"
>;

function normalizeStaffEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/** Employment relationships are keyed by staff ID, never inferred from a name or email. */
export function isSameStaffDirectoryPerson(left: StaffDirectorySourceRow, right: StaffDirectorySourceRow): boolean {
  return left.id === right.id;
}

function staffDirectoryRetentionScore(row: StaffDirectorySourceRow): number {
  let score = 0;
  if (row.user_id) score += 100;
  if (normalizeStaffEmail(row.email)) score += 50;
  if (row.employment_status === "active") score += 20;
  if (row.employment_status === "on_leave") score += 10;
  return score;
}

/** Prefer linked auth, contactable rows, and active employment when imports overlap. */
export function pickPreferredStaffDirectoryRecord<T extends StaffDirectorySourceRow>(
  existing: T,
  candidate: T,
): T {
  const existingScore = staffDirectoryRetentionScore(existing);
  const candidateScore = staffDirectoryRetentionScore(candidate);
  if (candidateScore !== existingScore) {
    return candidateScore > existingScore ? candidate : existing;
  }
  return candidate.updated_at >= existing.updated_at ? candidate : existing;
}

/** Collapse repeated query rows only; preserve each employment record and its relationships. */
export function dedupeStaffDirectoryRecords<T extends StaffDirectorySourceRow>(rows: T[]): T[] {
  const kept: T[] = [];
  for (const row of rows) {
    const matchIndex = kept.findIndex((existing) => isSameStaffDirectoryPerson(existing, row));
    if (matchIndex === -1) {
      kept.push(row);
      continue;
    }
    kept[matchIndex] = pickPreferredStaffDirectoryRecord(kept[matchIndex], row);
  }
  return kept;
}

export const STAFF_DIRECTORY_IDENTITY_SELECT =
  "id, facility_id, user_id, first_name, last_name, email, staff_role, employment_status, updated_at, deleted_at";

/** Count active employment records by stable staff ID. */
export function countUniqueActiveStaffDirectoryRecords(rows: StaffDirectorySourceRow[]): number {
  return dedupeStaffDirectoryRecords(rows).filter((row) => row.employment_status === "active").length;
}

/** One picker option per employment record. */
export function buildDedupedStaffPickerOptions(
  rows: StaffDirectorySourceRow[],
): { id: string; label: string }[] {
  return dedupeStaffDirectoryRecords(rows)
    .filter((row) => row.employment_status === "active")
    .map((row) => {
      const label = `${row.first_name?.trim() ?? ""} ${row.last_name?.trim() ?? ""}`.trim();
      return { id: row.id, label: label || "Staff member" };
    })
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
}

type SupabaseCertRow = {
  staff_id: string;
  certification_type: string | null;
  status: string;
  expiration_date: string | null;
  deleted_at: string | null;
};

type SupabaseShiftRow = AssignmentSnapshot & {
  custom_start_time: string | null; custom_end_time: string | null;
  staff_id: string;
  shift_date: string;
  shift_type: string;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

/** Upcoming-shift query floor: Eastern calendar today (not UTC `toISOString().slice`). */
export function staffUpcomingShiftCutoffIso(now: Date = new Date()): string {
  return todayFacilityDateIso(now);
}

export async function fetchStaffFromSupabase(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<StaffRow[]> {
  let staffQuery = supabase
    .from("staff" as never)
    .select(
      "id, facility_id, user_id, first_name, last_name, email, staff_role, employment_status, photo_url, updated_at, deleted_at",
    )
    .is("deleted_at", null)
    .limit(300);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    staffQuery = staffQuery.eq("facility_id", selectedFacilityId);
  }

  const staffResult = (await staffQuery) as unknown as QueryResult<SupabaseStaffRow>;
  const rawStaffList = staffResult.data ?? [];
  if (staffResult.error) {
    throw staffResult.error;
  }
  if (rawStaffList.length === 0) {
    return [];
  }

  const staffList = dedupeStaffDirectoryRecords(rawStaffList);

  const staffIds = staffList.map((s) => s.id);
  const today = staffUpcomingShiftCutoffIso();

  // The cert and shift queries both depend only on the staff id list — run
  // them in parallel instead of chaining two serial round-trips. Saves ~1 RTT
  // on every load.
  let shiftsQuery = supabase
    .from("shift_assignments" as never)
    .select(`staff_id, shift_date, shift_type, custom_start_time, custom_end_time, ${ASSIGNMENT_SNAPSHOT_SELECT}, schedules!inner(status, deleted_at)` )
    .eq("schedules.status", "published").is("schedules.deleted_at", null)
    .in("staff_id", staffIds)
    .gte("shift_date", today)
    .is("deleted_at", null)
    .in("status", ["assigned", "confirmed"])
    .order("shift_date", { ascending: true }).order("custom_start_time", { ascending: true });

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    shiftsQuery = shiftsQuery.eq("facility_id", selectedFacilityId);
  }

  const [certsResult, shiftsResult, certificationRules] = (await Promise.all([
    supabase
      .from("staff_certifications" as never)
      .select("staff_id, certification_type, status, expiration_date, deleted_at")
      .in("staff_id", staffIds)
      .is("deleted_at", null),
    shiftsQuery,
    loadCertificationRules(supabase),
  ])) as unknown as [
    QueryResult<SupabaseCertRow>,
    QueryResult<SupabaseShiftRow>,
    Awaited<ReturnType<typeof loadCertificationRules>>,
  ];
  const policyFor = certificationPolicyResolver(certificationRules);

  if (certsResult.error) {
    throw certsResult.error;
  }
  if (shiftsResult.error) {
    throw shiftsResult.error;
  }

  const certsByStaff = new Map<string, SupabaseCertRow[]>();
  for (const row of certsResult.data ?? []) {
    const list = certsByStaff.get(row.staff_id) ?? [];
    list.push(row);
    certsByStaff.set(row.staff_id, list);
  }

  const nextShiftByStaff = new Map<string, SupabaseShiftRow>();
  for (const row of shiftsResult.data ?? []) {
    if (!nextShiftByStaff.has(row.staff_id)) {
      nextShiftByStaff.set(row.staff_id, row);
    }
  }

  return staffList.map((s) => {
    const first = s.first_name?.trim() ?? "";
    const last = s.last_name?.trim() ?? "";
    const name = `${first} ${last}`.trim() || "Staff member";
    const initials = `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "ST";
    const policy = policyFor(s.facility_id ?? null);
    const certState = evaluateStaffCertifications({
      staffRole: s.staff_role,
      certs: certsByStaff.get(s.id) ?? [],
      policy,
    }).status;
    const uiRole = mapDbStaffRoleToUi(s.staff_role);
    const uiStatus = mapEmploymentToUiStatus(s.employment_status);
    const nextShift = formatStaffRosterNextShift(nextShiftByStaff.get(s.id));

    return {
      id: s.id,
      name,
      initials,
      role: uiRole,
      roleLabel: formatStaffRoleLabel(s.staff_role),
      status: uiStatus,
      certifications: certState,
      certRequirementsSetUp: policy.configured,
      nextShift,
      photoUrl: s.photo_url,
      facilityId: s.facility_id,
      userId: s.user_id,
    };
  });
}

function mapDbStaffRoleToUi(role: string): StaffRole {
  if (role === "rn" || role === "lpn") return "nurse";
  if (role === "medication_tech" || role === "dietary_staff") return "med_tech";
  if (
    role === "administrator" ||
    role === "assistant_administrator" ||
    role === "admin_support_coordinator" ||
    role === "activities_director" ||
    role === "dietary_manager" ||
    role === "owner" ||
    role === "ceo" ||
    role === "coo" ||
    role === "cfo"
  ) return "admin";
  if (
    role === "cna" ||
    role === "resident_aide" ||
    role === "resident_services_coordinator" ||
    role === "maintenance" ||
    role === "maintenance_director" ||
    role === "maintenance_standby" ||
    role === "housekeeping" ||
    role === "driver" ||
    role === "dietary_aide" ||
    role === "cook" ||
    role === "activity_aide" ||
    role === "marketing_consultant" ||
    role === "other"
  ) {
    return "caregiver";
  }
  return "admin";
}

export function formatStaffRoleLabel(role: string): string {
  // Title case with acronyms kept: "CNA", "CEO", "Medication Tech" (never "Ceo"; COL-652).
  return enumLabel(role, { case: "title" });
}

export function mapEmploymentToUiStatus(employment: string): StaffStatus {
  if (employment === "on_leave") return "on_leave";
  if (employment === "terminated" || employment === "suspended") return "inactive";
  return "active";
}
