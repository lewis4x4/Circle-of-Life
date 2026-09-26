import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { KIOSK_DEVICE_HEADER, kioskStaffDisplay, type KioskIdentifyResponse, type PunchType } from "@/lib/timeclock/kiosk-contract";
import { loadKioskPlannedContext } from "@/lib/timeclock/planned-context";
import { isRecord, kioskErrorResponse, kioskSubject, kioskSubjectArgs, kioskSubjectErrorResponse } from "@/lib/timeclock/server";

/**
 * POST /api/kiosk/timeclock/identify — validate a tapped name (`staff_id`) or
 * the badge or employee number, plus PIN, and return the valid next actions,
 * so the kiosk shows one button. Counts toward lockouts and throttles exactly
 * like a punch (spec 37 §4.1). Only the name path hears tries_left.
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
  const subject = kioskSubject(body);
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!subject || !/^[0-9]{6}$/.test(pin)) {
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
    ...kioskSubjectArgs(subject),
    p_pin: pin,
  });
  if (error) {
    logError("timeclock.identify", error, { action: "identify" });
    return kioskErrorResponse("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) {
    return kioskSubjectErrorResponse(subject, result, String(result.error ?? "not_recognized"));
  }
  const response: KioskIdentifyResponse = {
    first_name: String(result.first_name ?? ""),
    state: (result.state as KioskIdentifyResponse["state"]) ?? "out",
    next_actions: Array.isArray(result.next_actions) ? (result.next_actions as PunchType[]) : ["in"],
    today_worked_minutes: Number(result.today_worked_minutes ?? 0),
    ...kioskStaffDisplay(result),
    planned_context: await loadKioskPlannedContext(admin, result),
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
