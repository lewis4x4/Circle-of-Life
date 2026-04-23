import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type StaffRole = "nurse" | "caregiver" | "med_tech" | "admin";
export type StaffStatus = "active" | "on_leave" | "off_shift";
export type CertificationStatus = "current" | "expiring_soon" | "expired";

export type StaffRow = {
  id: string;
  name: string;
  initials: string;
  role: StaffRole;
  status: StaffStatus;
  certifications: CertificationStatus;
  nextShift: string;
  overtimeRisk: "low" | "medium" | "high";
  photoUrl?: string | null;
};

type SupabaseStaffRow = {
  id: string;
  first_name: string;
  last_name: string;
  staff_role: string;
  employment_status: string;
  photo_url: string | null;
  deleted_at: string | null;
};

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
    .select("id, first_name, last_name, staff_role, employment_status, photo_url, deleted_at")
    .is("deleted_at", null)
    .limit(300);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    staffQuery = staffQuery.eq("facility_id", selectedFacilityId);
  }

  const staffResult = (await staffQuery) as unknown as QueryResult<SupabaseStaffRow>;
  const staffList = staffResult.data ?? [];
  if (staffResult.error) {
    throw staffResult.error;
  }
  if (staffList.length === 0) {
    return [];
  }

  const staffIds = staffList.map((s) => s.id);
  const today = new Date().toISOString().slice(0, 10);

  const certsResult = (await supabase
    .from("staff_certifications" as never)
    .select("staff_id, status, expiration_date, deleted_at")
    .in("staff_id", staffIds)
    .is("deleted_at", null)) as unknown as QueryResult<SupabaseCertRow>;
  if (certsResult.error) {
    throw certsResult.error;
  }

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

  const shiftsResult = (await shiftsQuery) as unknown as QueryResult<SupabaseShiftRow>;
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
    const shift = nextShiftByStaff.get(s.id);
    const nextShift = shift ? formatNextShiftLabel(shift.shift_date, shift.shift_type) : "—";
    const overtimeRisk = deriveOvertimeRisk(certState, s.employment_status);

    return {
      id: s.id,
      name,
      initials,
      role: uiRole,
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
  if (role === "cna") return "caregiver";
  if (role === "dietary_staff") return "med_tech";
  if (role === "administrator" || role === "activities_director" || role === "dietary_manager") return "admin";
  if (role === "maintenance" || role === "housekeeping" || role === "driver" || role === "other") {
    return "caregiver";
  }
  return "admin";
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

function formatNextShiftLabel(shiftDate: string, shiftType: string): string {
  const parsed = new Date(`${shiftDate}T12:00:00`);
  const datePart = Number.isNaN(parsed.getTime())
    ? shiftDate
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
  const typeLabel =
    shiftType === "day"
      ? "Day"
      : shiftType === "evening"
        ? "Evening"
        : shiftType === "night"
          ? "Night"
          : "Shift";
  return `${datePart} · ${typeLabel}`;
}
