import { FLOOR_DEVICE_HEADER, type FloorRosterPerson, type FloorRosterResponse } from "@/lib/floor/contract";
import { floorErrorResponse, floorJson } from "@/lib/floor/server";
import { logError } from "@/lib/observability/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isRecord } from "@/lib/timeclock/server";

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function person(row: unknown): FloorRosterPerson | null {
  if (!isRecord(row) || typeof row.staff_id !== "string") return null;
  return {
    staff_id: row.staff_id,
    user_id: null,
    display_name: String(row.display_name ?? ""),
    initials: String(row.initials ?? ""),
    role_label: String(row.role_label ?? ""),
    clocked_in_at: text(row.clocked_in_at),
    last_on_this_device: text(row.last_on_this_device),
  };
}

/**
 * GET /api/floor/roster: who is on shift for this floor tablet's lock screen
 * (spec 40 §1). Only staff clocked in at the tablet's facility, in its roster
 * roles; the database decides who that is.
 */
export async function GET(request: Request) {
  const deviceToken = request.headers.get(FLOOR_DEVICE_HEADER)?.trim() ?? "";
  if (!deviceToken) return floorErrorResponse("device_unknown");

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return floorErrorResponse("unavailable");
  }

  const { data, error } = await admin.rpc("floor_roster", { p_device_token: deviceToken });
  if (error) {
    logError("floor.roster", error, { action: "roster" });
    return floorErrorResponse("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) return floorErrorResponse(String(result.error ?? "device_unknown"));

  const roster = Array.isArray(result.roster) ? result.roster.map(person).filter((p): p is FloorRosterPerson => p !== null) : [];
  // floor_roster answers staff ids; the offline queues are keyed by login user
  // id. Only the people the database just listed are looked up.
  if (roster.length > 0) {
    const { data: logins, error: loginError } = await admin
      .from("staff")
      .select("id, user_id")
      .in("id", roster.map((p) => p.staff_id));
    if (loginError) {
      logError("floor.roster", loginError, { action: "roster_user_ids" });
    } else {
      const byStaff = new Map((logins ?? []).map((row) => [row.id, row.user_id]));
      for (const p of roster) p.user_id = byStaff.get(p.staff_id) ?? null;
    }
  }
  const idle = Number(result.idle_lock_minutes);
  const response: FloorRosterResponse = {
    facility_name: String(result.facility_name ?? ""),
    device_label: String(result.device_label ?? ""),
    idle_lock_minutes: Number.isFinite(idle) && idle > 0 ? idle : 3,
    throttled_until: text(result.throttled_until),
    roster,
  };
  return floorJson(response);
}
