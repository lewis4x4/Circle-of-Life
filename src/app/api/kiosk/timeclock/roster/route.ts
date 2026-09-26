import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { KIOSK_DEVICE_HEADER, type KioskRosterEntry, type KioskRosterResponse } from "@/lib/timeclock/kiosk-contract";
import { isRecord, kioskErrorResponse } from "@/lib/timeclock/server";

function entry(row: unknown): KioskRosterEntry | null {
  if (!isRecord(row) || typeof row.staff_id !== "string" || typeof row.display_name !== "string" || !row.display_name.trim()) return null;
  return { staff_id: row.staff_id, display_name: row.display_name.trim() };
}

/**
 * GET /api/kiosk/timeclock/roster — the names on the kiosk's Staff clock:
 * staff with a PIN who work at this kiosk's building, name only, in the order
 * the database sorts them. Never an employee number or anything about the PIN.
 * A throttled kiosk still gets its names, with the time PIN entry reopens.
 */
export async function GET(request: Request) {
  const deviceToken = request.headers.get(KIOSK_DEVICE_HEADER)?.trim() ?? "";
  if (!deviceToken) return kioskErrorResponse("device_unknown");

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return kioskErrorResponse("unavailable");
  }

  const { data, error } = await admin.rpc("timeclock_kiosk_roster", { p_device_token: deviceToken });
  if (error) {
    logError("timeclock.kiosk_roster", error, { action: "kiosk_roster" });
    return kioskErrorResponse("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) return kioskErrorResponse(String(result.error ?? "unavailable"));
  const response: KioskRosterResponse = {
    roster: Array.isArray(result.roster) ? result.roster.map(entry).filter((e): e is KioskRosterEntry => e !== null) : [],
    throttled_until: typeof result.throttled_until === "string" ? result.throttled_until : null,
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
