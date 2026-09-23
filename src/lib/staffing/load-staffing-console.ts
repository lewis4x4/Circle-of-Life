import type { SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";
import { fetchFacilityShiftDefinitions } from "@/lib/caregiver/shift";
import { assignmentSpan } from "@/lib/workforce/model";

import {
  facilityDateIsoDaysFromToday,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";
import {
  buildDedupedStaffPickerOptions,
  STAFF_DIRECTORY_IDENTITY_SELECT,
  type StaffDirectorySourceRow,
} from "@/lib/staff/load-staff";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { formatStaffingConsoleExpiredCertStaffName } from "@/lib/staffing/staffing-console-display-copy";
import {
  fetchStaffingCoverageScope,
  type StaffingCoverageScope,
} from "@/lib/staffing/staffing-coverage-scope";
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
  /** What the gap and credential panels examined; null when that read failed. */
  coverageScope: StaffingCoverageScope | null;
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
  facility_id: string;
  schedule_id: string;
  custom_start_time: string | null;
  custom_end_time: string | null;
  staff_id: string;
  shift_date: string;
  shift_type: Database["public"]["Enums"]["shift_type"];
  status: Database["public"]["Enums"]["shift_assignment_status"];
};

type SupabaseStaffGapMini = {
  id: string;
  staff_role: string;
};

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
  const todayIso = todayFacilityDateIso();

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
    const expirationAt = row.expiration_date ? new Date(`${row.expiration_date}T23:59:59`).getTime() : now;
    const daysExpired = Math.max(1, Math.ceil((now - expirationAt) / 86_400_000));
    return {
      id: row.id,
      staffName: formatStaffingConsoleExpiredCertStaffName(staff),
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
  const todayIso = todayFacilityDateIso(now);
  const endDateIso = facilityDateIsoDaysFromToday(2, now);

  let shiftsQuery = supabase
    .from("shift_assignments" as never)
    .select("id, staff_id, facility_id, schedule_id, shift_date, shift_type, status, custom_start_time, custom_end_time")
    .is("deleted_at", null)
    .gte("shift_date", todayIso)
    .lte("shift_date", endDateIso)
    .in("status", ["swap_requested", "called_out", "no_show"])
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

  const definitions = await fetchFacilityShiftDefinitions(supabase, [...new Set(shiftRows.map((row) => row.facility_id))]);
  const roleByStaffId = new Map(staffRows.map((row) => [row.id, mapDbStaffRoleToLabel(row.staff_role)] as const));
  const grouped = new Map<string, ShiftGap>();

  for (const row of shiftRows) {
    const role = roleByStaffId.get(row.staff_id) ?? "Staff";
    const urgency: ShiftGap["urgency"] =
      row.status === "called_out" || row.status === "no_show" ? "critical" : "warning";
    const shiftLabel = assignmentSpan(row, definitions.get(row.facility_id) ?? [])?.label ?? `${row.shift_type} · times not configured`;
    const key = `${row.facility_id}:${row.shift_date}:${shiftLabel}:${role}:${urgency}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.shortage += 1;
      continue;
    }
    grouped.set(key, {
      id: key,
      date: formatShiftDateLabel(row.shift_date),
      shift: shiftLabel,
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

function formatShiftDateLabel(shiftDate: string, now: Date = new Date()): string {
  const currentDate = todayFacilityDateIso(now);
  const tomorrowIso = facilityDateIsoDaysFromToday(1, now);
  if (shiftDate === currentDate) return "Today";
  if (shiftDate === tomorrowIso) return "Tomorrow";
  return format(new Date(`${shiftDate}T12:00:00`), "MMM d");
}


export async function fetchStaffOptions(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<StaffOption[]> {
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return [];
  const res = (await supabase
    .from("staff" as never)
    .select(STAFF_DIRECTORY_IDENTITY_SELECT)
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)) as unknown as QueryResult<StaffDirectorySourceRow>;
  if (res.error) throw res.error;
  return buildDedupedStaffPickerOptions(res.data ?? []);
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
  const [snapshots, certWarnings, shiftGaps, staffOptions, requisitions, attendance, coverageScope] =
    await Promise.all([
      fetchSnapshotsFromSupabase(selectedFacilityId, supabase),
      fetchExpiredCertificationWarnings(selectedFacilityId, supabase),
      fetchShiftAssignmentGaps(selectedFacilityId, supabase),
      fetchStaffOptions(selectedFacilityId, supabase),
      fetchStaffRequisitions(selectedFacilityId, supabase),
      fetchAttendanceEvents(selectedFacilityId, supabase),
      fetchCoverageScopeOrNull(selectedFacilityId, supabase),
    ]);

  return { snapshots, certWarnings, shiftGaps, staffOptions, requisitions, attendance, coverageScope };
}

/** A failed scope read must not blank the console; the panels say "could not be checked" instead. */
export async function fetchCoverageScopeOrNull(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<StaffingCoverageScope | null> {
  try {
    return await fetchStaffingCoverageScope(selectedFacilityId, supabase);
  } catch (error) {
    console.error("[staffing] coverage scope read failed:", error);
    return null;
  }
}
