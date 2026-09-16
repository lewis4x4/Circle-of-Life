import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { KIOSK_DEVICE_HEADER, isPunchType, type KioskPunchReceipt, type PunchType } from "@/lib/timeclock/kiosk-contract";
import { badgeLookupHmac, isRecord, kioskErrorResponse } from "@/lib/timeclock/server";

/** Database codes that mean "recorded as a sync rejection for the manager" on an offline replay. */
const OFFLINE_REJECTED = new Set(["not_recognized", "locked", "inactive_staff", "not_assigned", "invalid_next_type", "pin_unavailable", "facility_off"]);

/**
 * POST /api/kiosk/timeclock/punch — record one punch (spec 37 §4.1, §5).
 * Server time is the punch time when online; the device time rides along and
 * is flagged when it drifts. Idempotent on client_punch_id, so a lost response
 * is safe to retry with the same body.
 */
export async function POST(request: Request) {
  const deviceToken = request.headers.get(KIOSK_DEVICE_HEADER)?.trim() ?? "";
  if (!deviceToken) return kioskErrorResponse("device_unknown");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return kioskErrorResponse("invalid_input");
  }
  if (!isRecord(body)) return kioskErrorResponse("invalid_input");

  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const punchType = body.punch_type;
  const clientPunchId = typeof body.client_punch_id === "string" ? body.client_punch_id : "";
  const capturedOffline = body.captured_offline === true;
  const deviceTime = typeof body.device_time === "string" ? new Date(body.device_time) : null;

  if (!isPunchType(punchType) || !UUID_STRING_RE.test(clientPunchId) || !identifier || identifier.length > 64) {
    return kioskErrorResponse("invalid_input");
  }
  if (!deviceTime || Number.isNaN(deviceTime.getTime())) {
    return kioskErrorResponse("invalid_input");
  }
  // Online punches need a well formed PIN. An offline replay may have lost its
  // PIN to a page reload; the database records that as pin_unavailable.
  if (!capturedOffline && !/^[0-9]{6}$/.test(pin)) {
    return kioskErrorResponse("not_recognized");
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return kioskErrorResponse("unavailable");
  }

  const { data, error } = await admin.rpc("timeclock_record_punch", {
    p_device_token: deviceToken,
    p_identifier: identifier,
    p_badge_lookup_hmac: badgeLookupHmac(identifier),
    p_pin: pin,
    p_punch_type: punchType,
    p_device_time: deviceTime.toISOString(),
    p_client_punch_id: clientPunchId,
    p_captured_offline: capturedOffline,
  });
  if (error) {
    logError("timeclock.punch", error, { action: "record_punch", clientPunchId });
    return kioskErrorResponse("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) {
    const code = String(result.error ?? "not_recognized");
    if (capturedOffline && OFFLINE_REJECTED.has(code)) {
      return kioskErrorResponse("rejected_offline");
    }
    return kioskErrorResponse(code);
  }

  const receipt: KioskPunchReceipt = {
    punch_id: String(result.punch_id),
    replayed: result.replayed === true,
    first_name: String(result.first_name ?? ""),
    punch_type: (result.punch_type as PunchType) ?? punchType,
    punched_at: String(result.punched_at),
    flags: Array.isArray(result.flags) ? (result.flags as string[]) : [],
    state: (result.state as KioskPunchReceipt["state"]) ?? "out",
    next_actions: Array.isArray(result.next_actions) ? (result.next_actions as PunchType[]) : ["in"],
    today_worked_minutes: Number(result.today_worked_minutes ?? 0),
  };
  return NextResponse.json(receipt, { headers: { "Cache-Control": "no-store" } });
}
