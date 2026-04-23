import type { SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type SnapshotRow = {
  id: string;
  snapshotAt: string;
  shift: string;
  residentsPresent: number;
  staffOnDuty: number;
  ratio: number;
  requiredRatio: number;
  isCompliant: boolean;
};

export type ShiftGap = {
  id: string;
  date: string;
  shift: string;
  role: string;
  shortage: number;
  urgency: "critical" | "warning";
};

export type CertWarning = {
  id: string;
  staffName: string;
  role: string;
  certName: string;
  daysExpired: number;
};

export type StaffOption = { id: string; label: string };

export type RequisitionStatus =
  | "draft"
  | "open"
  | "interviewing"
  | "offered"
  | "filled"
  | "cancelled";

export type RequisitionRow = {
  id: string;
  role_title: string;
  status: RequisitionStatus;
  target_hire_date: string | null;
  department: string | null;
};

export type AttendanceEventRow = {
  id: string;
  event_type: string;
  occurred_at: string;
  reason: string | null;
  staff: { first_name: string; last_name: string } | null;
};

export type StaffingConsoleData = {
  snapshots: SnapshotRow[];
  certWarnings: CertWarning[];
  shiftGaps: ShiftGap[];
  staffOptions: StaffOption[];
  requisitions: RequisitionRow[];
  attendance: AttendanceEventRow[];
};

type SupabaseSnapshotRow = {
  id: string;
  snapshot_at: string;
  shift: string;
  residents_present: number;
  staff_on_duty: number;
  ratio: number | string;
  required_ratio: number | string;
  is_compliant: boolean;
};

type SupabaseExpiredCertRow = {
  id: string;
  staff_id: string;
  certification_name: string;
  expiration_date: string | null;
  status: string;
};

type SupabaseStaffWarningMini = {
  id: string;
  first_name: string;
  last_name: string;
  staff_role: string;
};

type SupabaseShiftGapRow = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_type: Database["public"]["Enums"]["shift_type"];
  status: Database["public"]["Enums"]["shift_assignment_status"];
};

type SupabaseStaffGapMini = {
  id: string;
  staff_role: string;
};

type StaffOptionRow = { id: string; first_name: string; last_name: string };

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export async function fetchSnapshotsFromSupabase(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<SnapshotRow[]> {
  let q = supabase
    .from("staffing_ratio_snapshots" as never)
    .select("id, snapshot_at, shift, residents_present, staff_on_duty, ratio, required_ratio, is_compliant")
    .order("snapshot_at", { ascending: false })
    .limit(10);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = await q;
  const list = (res.data as SupabaseSnapshotRow[]) ?? [];
  return list.map((r) => ({
    id: r.id,
    snapshotAt: r.snapshot_at,
    shift: r.shift,
    residentsPresent: r.residents_present,
    staffOnDuty: r.staff_on_duty,
    ratio: Number(r.ratio),
    requiredRatio: Number(r.required_ratio),
    isCompliant: r.is_compliant,
  }));
}

export async function fetchExpiredCertificationWarnings(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<CertWarning[]> {
  const todayIso = new Date().toISOString().slice(0, 10);

  let certsQuery = supabase
    .from("staff_certifications" as never)
    .select("id, staff_id, certification_name, expiration_date, status")
    .is("deleted_at", null)
    .or(`status.in.(expired,revoked),expiration_date.lt.${todayIso}`)
    .order("expiration_date", { ascending: true })
    .limit(10);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    certsQuery = certsQuery.eq("facility_id", selectedFacilityId);
  }

  const certsRes = (await certsQuery) as unknown as QueryResult<SupabaseExpiredCertRow>;
  const certs = certsRes.data ?? [];
  if (certsRes.error) throw certsRes.error;
  if (certs.length === 0) return [];

  const staffIds = [...new Set(certs.map((row) => row.staff_id))];
  const staffRes = (await supabase
    .from("staff" as never)
    .select("id, first_name, last_name, staff_role")
    .in("id", staffIds)
    .is("deleted_at", null)) as unknown as QueryResult<SupabaseStaffWarningMini>;
  const staffRows = staffRes.data ?? [];
  if (staffRes.error) throw staffRes.error;

  const staffById = new Map(staffRows.map((row) => [row.id, row] as const));
  const now = Date.now();

  return certs.map((row) => {
    const staff = staffById.get(row.staff_id);
    const first = staff?.first_name?.trim() ?? "";
    const last = staff?.last_name?.trim() ?? "";
    const expirationAt = row.expiration_date ? new Date(`${row.expiration_date}T23:59:59`).getTime() : now;
    const daysExpired = Math.max(1, Math.ceil((now - expirationAt) / 86_400_000));
    return {
      id: row.id,
      staffName: `${first} ${last}`.trim() || "Unknown staff",
      role: mapDbStaffRoleToLabel(staff?.staff_role ?? "other"),
      certName: row.certification_name,
      daysExpired,
    };
  });
}

function mapDbStaffRoleToLabel(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized === "cna") return "CNA";
  if (normalized === "rn") return "RN";
  if (normalized === "lpn") return "LPN";
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function fetchShiftAssignmentGaps(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<ShiftGap[]> {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const inTwoDays = new Date(now);
  inTwoDays.setDate(inTwoDays.getDate() + 2);
  const endDateIso = inTwoDays.toISOString().slice(0, 10);

  let shiftsQuery = supabase
    .from("shift_assignments" as never)
    .select("id, staff_id, shift_date, shift_type, status")
    .is("deleted_at", null)
    .gte("shift_date", todayIso)
    .lte("shift_date", endDateIso)
    .in("status", ["assigned", "swap_requested", "called_out", "no_show"])
    .order("shift_date", { ascending: true });

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    shiftsQuery = shiftsQuery.eq("facility_id", selectedFacilityId);
  }

  const shiftsRes = (await shiftsQuery) as unknown as QueryResult<SupabaseShiftGapRow>;
  const shiftRows = shiftsRes.data ?? [];
  if (shiftsRes.error) throw shiftsRes.error;
  if (shiftRows.length === 0) return [];

  const staffIds = [...new Set(shiftRows.map((row) => row.staff_id))];
  const staffRes = (await supabase
    .from("staff" as never)
    .select("id, staff_role")
    .in("id", staffIds)
    .is("deleted_at", null)) as unknown as QueryResult<SupabaseStaffGapMini>;
  const staffRows = staffRes.data ?? [];
  if (staffRes.error) throw staffRes.error;

  const roleByStaffId = new Map(staffRows.map((row) => [row.id, mapDbStaffRoleToLabel(row.staff_role)] as const));
  const grouped = new Map<string, ShiftGap>();

  for (const row of shiftRows) {
    const role = roleByStaffId.get(row.staff_id) ?? "Staff";
    const urgency: ShiftGap["urgency"] =
      row.status === "called_out" || row.status === "no_show" ? "critical" : "warning";
    const key = `${row.shift_date}:${row.shift_type}:${role}:${urgency}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.shortage += 1;
      continue;
    }
    grouped.set(key, {
      id: key,
      date: formatShiftDateLabel(row.shift_date),
      shift: formatShiftTypeLabel(row.shift_type),
      role,
      shortage: 1,
      urgency,
    });
  }

  return [...grouped.values()].sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === "critical" ? -1 : 1;
    return a.date.localeCompare(b.date);
  });
}

function formatShiftDateLabel(shiftDate: string): string {
  const today = new Date();
  const currentDate = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  if (shiftDate === currentDate) return "Today";
  if (shiftDate === tomorrowIso) return "Tomorrow";
  return format(new Date(`${shiftDate}T12:00:00`), "MMM d");
}

function formatShiftTypeLabel(shiftType: Database["public"]["Enums"]["shift_type"]): string {
  if (shiftType === "day") return "Day (7a-3p)";
  if (shiftType === "evening") return "Evening (3p-11p)";
  if (shiftType === "night") return "Night (11p-7a)";
  return "Custom";
}

export async function fetchStaffOptions(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<StaffOption[]> {
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return [];
  const res = (await supabase
    .from("staff" as never)
    .select("id, first_name, last_name")
    .eq("facility_id", selectedFacilityId)
    .eq("employment_status", "active")
    .is("deleted_at", null)
    .order("last_name", { ascending: true })) as unknown as QueryResult<StaffOptionRow>;
  if (res.error) throw res.error;
  return (res.data ?? []).map((row) => ({ id: row.id, label: `${row.first_name} ${row.last_name}`.trim() }));
}

export async function fetchStaffRequisitions(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<RequisitionRow[]> {
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return [];
  const res = (await supabase
    .from("staff_requisitions" as never)
    .select("id, role_title, status, target_hire_date, department")
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .order("opened_at", { ascending: false })) as unknown as QueryResult<RequisitionRow>;
  if (res.error) throw res.error;
  return res.data ?? [];
}

export async function fetchAttendanceEvents(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<AttendanceEventRow[]> {
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return [];
  const res = (await supabase
    .from("staff_attendance_events" as never)
    .select("id, event_type, occurred_at, reason, staff:staff_id(first_name, last_name)")
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(8)) as unknown as QueryResult<AttendanceEventRow>;
  if (res.error) throw res.error;
  return res.data ?? [];
}

export async function loadStaffingConsole(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<StaffingConsoleData> {
  const [snapshots, certWarnings, shiftGaps, staffOptions, requisitions, attendance] =
    await Promise.all([
      fetchSnapshotsFromSupabase(selectedFacilityId, supabase),
      fetchExpiredCertificationWarnings(selectedFacilityId, supabase),
      fetchShiftAssignmentGaps(selectedFacilityId, supabase),
      fetchStaffOptions(selectedFacilityId, supabase),
      fetchStaffRequisitions(selectedFacilityId, supabase),
      fetchAttendanceEvents(selectedFacilityId, supabase),
    ]);

  return { snapshots, certWarnings, shiftGaps, staffOptions, requisitions, attendance };
}
