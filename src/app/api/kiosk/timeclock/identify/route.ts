import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { KIOSK_DEVICE_HEADER, type KioskIdentifyResponse, type PunchType } from "@/lib/timeclock/kiosk-contract";
import { badgeLookupHmac, isRecord, kioskErrorResponse } from "@/lib/timeclock/server";

/**
 * POST /api/kiosk/timeclock/identify — validate the badge or employee number
 * plus PIN and return the valid next actions, so the kiosk shows one button.
 * Counts toward lockouts and throttles exactly like a punch (spec 37 §4.1).
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
  if (!identifier || identifier.length > 64 || !/^[0-9]{6}$/.test(pin)) {
    return kioskErrorResponse("not_recognized");
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return kioskErrorResponse("unavailable");
  }

  const { data, error } = await admin.rpc("timeclock_identify", {
    p_device_token: deviceToken,
    p_identifier: identifier,
    p_badge_lookup_hmac: badgeLookupHmac(identifier),
    p_pin: pin,
  });
  if (error) {
    logError("timeclock.identify", error, { action: "identify" });
    return kioskErrorResponse("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) {
    return kioskErrorResponse(String(result.error ?? "not_recognized"));
  }
  const response: KioskIdentifyResponse = {
    first_name: String(result.first_name ?? ""),
    state: (result.state as KioskIdentifyResponse["state"]) ?? "out",
    next_actions: Array.isArray(result.next_actions) ? (result.next_actions as PunchType[]) : ["in"],
    today_worked_minutes: Number(result.today_worked_minutes ?? 0),
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
