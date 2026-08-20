import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { formatStaffRosterNextShift } from "@/lib/staff/staff-roster-display-copy";
import type { Database } from "@/types/database";

export type StaffRole = "nurse" | "caregiver" | "med_tech" | "admin";
export type StaffStatus = "active" | "on_leave" | "off_shift";
export type CertificationStatus = "current" | "expiring_soon" | "expired";

export type StaffRow = {
  id: string;
  name: string;
  initials: string;
  role: StaffRole;
  roleLabel: string;
  status: StaffStatus;
  certifications: CertificationStatus;
  nextShift: string;
  overtimeRisk: "low" | "medium" | "high";
  photoUrl?: string | null;
};

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

function normalizeStaffPersonName(firstName: string, lastName: string): string {
  return `${firstName.trim().toLowerCase()} ${lastName.trim().toLowerCase()}`.trim();
}

/** True when two roster source rows represent the same person in the directory. */
export function isSameStaffDirectoryPerson(
  left: StaffDirectorySourceRow,
  right: StaffDirectorySourceRow,
): boolean {
  if (left.user_id && right.user_id && left.user_id === right.user_id) {
    return true;
  }

  const leftEmail = normalizeStaffEmail(left.email);
  const rightEmail = normalizeStaffEmail(right.email);
  if (leftEmail && rightEmail && leftEmail === rightEmail) {
    return true;
  }

  if (left.user_id && right.user_id && left.user_id !== right.user_id) {
    return false;
  }
  if (leftEmail && rightEmail && leftEmail !== rightEmail) {
    return false;
  }

  if (left.facility_id === right.facility_id) {
    const leftName = normalizeStaffPersonName(left.first_name, left.last_name);
    const rightName = normalizeStaffPersonName(right.first_name, right.last_name);
    if (leftName.length > 0 && leftName === rightName) {
      return true;
    }
  }

  return false;
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

/** Collapse duplicate staff rows so the Team directory shows each person once. */
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

type SupabaseCertRow = {
  staff_id: string;
  status: string;
  expiration_date: string | null;
  deleted_at: string | null;
};

type SupabaseShiftRow = {
  staff_id: string;
  shift_date: string;
  shift_type: string;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

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
  const today = new Date().toISOString().slice(0, 10);

  // The cert and shift queries both depend only on the staff id list — run
  // them in parallel instead of chaining two serial round-trips. Saves ~1 RTT
  // on every load.
  let shiftsQuery = supabase
    .from("shift_assignments" as never)
    .select("staff_id, shift_date, shift_type")
    .in("staff_id", staffIds)
    .gte("shift_date", today)
    .is("deleted_at", null)
    .in("status", ["assigned", "confirmed"])
    .order("shift_date", { ascending: true });

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    shiftsQuery = shiftsQuery.eq("facility_id", selectedFacilityId);
  }

  const [certsResult, shiftsResult] = (await Promise.all([
    supabase
      .from("staff_certifications" as never)
      .select("staff_id, status, expiration_date, deleted_at")
      .in("staff_id", staffIds)
      .is("deleted_at", null),
    shiftsQuery,
  ])) as unknown as [QueryResult<SupabaseCertRow>, QueryResult<SupabaseShiftRow>];

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
    const certState = aggregateCertStatus(certsByStaff.get(s.id) ?? []);
    const uiRole = mapDbStaffRoleToUi(s.staff_role);
    const uiStatus = mapEmploymentToUiStatus(s.employment_status);
    const nextShift = formatStaffRosterNextShift(nextShiftByStaff.get(s.id));
    const overtimeRisk = deriveOvertimeRisk(certState, s.employment_status);

    return {
      id: s.id,
      name,
      initials,
      role: uiRole,
      roleLabel: formatStaffRoleLabel(s.staff_role),
      status: uiStatus,
      certifications: certState,
      nextShift,
      overtimeRisk,
      photoUrl: s.photo_url,
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
    role === "activity_aide" ||
    role === "marketing_consultant" ||
    role === "other"
  ) {
    return "caregiver";
  }
  return "admin";
}

export function formatStaffRoleLabel(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized === "cna") return "CNA";
  if (normalized === "rn") return "RN";
  if (normalized === "lpn") return "LPN";
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function mapEmploymentToUiStatus(employment: string): StaffStatus {
  if (employment === "on_leave") return "on_leave";
  if (employment === "terminated" || employment === "suspended") return "off_shift";
  return "active";
}

function aggregateCertStatus(certs: SupabaseCertRow[]): CertificationStatus {
  if (certs.length === 0) return "current";
  const now = new Date();
  const soon = new Date();
  soon.setDate(soon.getDate() + 60);
  let worst: CertificationStatus = "current";
  for (const c of certs) {
    if (c.status === "expired" || c.status === "revoked") {
      return "expired";
    }
    if (c.expiration_date) {
      const exp = new Date(`${c.expiration_date}T23:59:59`);
      if (exp < now) return "expired";
      if (exp <= soon) worst = "expiring_soon";
    }
    if (c.status === "pending_renewal") {
      worst = "expiring_soon";
    }
  }
  return worst;
}

function deriveOvertimeRisk(cert: CertificationStatus, employment: string): "low" | "medium" | "high" {
  if (cert === "expired") return "high";
  if (employment === "on_leave") return "medium";
  if (cert === "expiring_soon") return "medium";
  return "low";
}
