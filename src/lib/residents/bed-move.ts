import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type BedMoveBed = {
  id: string;
  bed_label: string;
  status: string;
  current_resident_id: string | null;
  reserved_for_admission_case_id: string | null;
  is_temporarily_blocked: boolean;
  blocked_reason: string | null;
  rooms: { room_number: string; deleted_at: string | null } | null;
};
export type BedMoveResident = { id: string; bed_id: string | null; first_name: string; last_name: string };
export type BedMoveOption = { id: string; label: string; conflict: string | null };
export type BedMoveSnapshot = { facilityName: string; currentBedId: string | null; currentBedLabel: string; options: BedMoveOption[] };

export function classifyBedMoveOptions(beds: BedMoveBed[], residents: BedMoveResident[], residentId: string): BedMoveOption[] {
  const resident = residents.find((row) => row.id === residentId);
  return beds.map((bed) => {
    const holders = residents.filter((row) => row.bed_id === bed.id);
    const otherHolders = holders.filter((row) => row.id !== residentId);
    let conflict: string | null = null;
    if (otherHolders.length) {
      conflict = `Occupied by ${otherHolders.map((row) => `${row.first_name} ${row.last_name}`.trim() || "another resident").join(", ")}`;
    } else if (bed.current_resident_id && !holders.some((row) => row.id === bed.current_resident_id)) {
      conflict = "Assignment conflict — bed and resident records disagree";
    } else if (bed.id === resident?.bed_id) {
      conflict = "Current bed";
    } else if (bed.reserved_for_admission_case_id) {
      conflict = "Reserved for an admission";
    } else if (bed.is_temporarily_blocked) {
      conflict = `Temporarily blocked${bed.blocked_reason?.trim() ? ` — ${bed.blocked_reason.trim()}` : ""}`;
    } else if (!bed.rooms || bed.rooms.deleted_at) {
      conflict = "Room unavailable";
    } else if (bed.status !== "available") {
      conflict = ({ occupied: "Occupied", hold: "On hold", maintenance: "Maintenance", offline: "Out of service" } as Record<string, string>)[bed.status] ?? "Unavailable";
    }
    return { id: bed.id, label: `Room ${bed.rooms?.room_number || "not posted"} · Bed ${bed.bed_label}`, conflict };
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export async function loadBedMoveSnapshot(supabase: SupabaseClient<Database>, facilityId: string, residentId: string): Promise<BedMoveSnapshot> {
  const [bedsResult, residentsResult, facilityResult] = await Promise.all([
    supabase.from("beds").select("id, bed_label, status, current_resident_id, reserved_for_admission_case_id, is_temporarily_blocked, blocked_reason, rooms(room_number, deleted_at)", { count: "exact" }).eq("facility_id", facilityId).is("deleted_at", null),
    supabase.from("residents").select("id, bed_id, first_name, last_name", { count: "exact" }).eq("facility_id", facilityId).is("deleted_at", null).in("status", ["active", "hospital_hold", "loa"]),
    supabase.from("facilities").select("name").eq("id", facilityId).is("deleted_at", null).maybeSingle(),
  ]);
  if (facilityResult.error || !facilityResult.data?.name) throw new Error("The resident’s facility could not be verified. Refresh availability to try again.");
  // Never label a bed available from a partial read (including API row caps).
  for (const result of [bedsResult, residentsResult]) {
    if (result.error || !result.data || result.count == null || result.count !== result.data.length) {
      throw new Error("Bed availability could not be verified. Refresh availability to try again.");
    }
  }
  const beds = bedsResult.data as unknown as BedMoveBed[];
  const residents = residentsResult.data as BedMoveResident[];
  const resident = residents.find((row) => row.id === residentId);
  if (!resident) throw new Error("This resident is no longer on the active facility roster. Refresh the resident record.");
  const options = classifyBedMoveOptions(beds, residents, residentId);
  return {
    facilityName: facilityResult.data.name,
    currentBedId: resident.bed_id,
    currentBedLabel: options.find((bed) => bed.id === resident.bed_id)?.label ?? (resident.bed_id ? "Assigned bed unavailable" : "No bed assigned"),
    options,
  };
}

export function bedMoveErrorMessage(error: unknown): string {
  const message = typeof error === "object" && error && "message" in error ? String(error.message) : "";
  if (/stale|expected|assignment.*changed|bed.*changed/i.test(message)) return "This resident’s bed assignment changed. Review the refreshed current bed before trying again.";
  if (/occupied|no longer available|reserved|hold|maintenance|offline|conflict/i.test(message)) return "That bed is no longer available or has an assignment conflict. Review the refreshed bed list and choose another bed.";
  if (/permission|unauthori|not authorized|access denied|assignment authority required/i.test(message)) return "You do not have permission to change this resident’s bed.";
  return "The bed change could not be confirmed. Review the refreshed assignment before trying again.";
}
