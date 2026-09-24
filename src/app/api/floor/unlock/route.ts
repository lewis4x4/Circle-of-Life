import type { NextRequest } from "next/server";

import { FLOOR_DEVICE_HEADER, type FloorUnlockResponse } from "@/lib/floor/contract";
import { clearHavenSessionCookies, floorErrorResponse, floorJson, mintFloorSession } from "@/lib/floor/server";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isRecord } from "@/lib/timeclock/server";

const PIN_RE = /^[0-9]{6}$/;

/**
 * POST /api/floor/unlock: tap your name (or type your employee number), then
 * your timeclock PIN (spec 40 §1). On a verified unlock the database records
 * the unlock row and returns the person's login email; this route mints their
 * Supabase session onto the response cookies. The tablet never sees a token.
 *
 * If the session cannot be minted the unlock is ended again, so the ledger
 * never shows someone on a tablet they could not use.
 */
export async function POST(request: NextRequest) {
  const deviceToken = request.headers.get(FLOOR_DEVICE_HEADER)?.trim() ?? "";
  if (!deviceToken) return floorErrorResponse("device_unknown");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return floorErrorResponse("invalid_input");
  }
  if (!isRecord(body)) return floorErrorResponse("invalid_input");
  const staffId = typeof body.staff_id === "string" ? body.staff_id.trim() : "";
  const employeeNumber = typeof body.employee_number === "string" ? body.employee_number.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if ((staffId === "") === (employeeNumber === "")) return floorErrorResponse("invalid_input");
  if (staffId && !UUID_STRING_RE.test(staffId)) return floorErrorResponse("invalid_input");
  if (employeeNumber.length > 64) return floorErrorResponse("invalid_input");
  if (!PIN_RE.test(pin)) return floorErrorResponse("not_recognized");

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return floorErrorResponse("unavailable");
  }

  const { data, error } = await admin.rpc("floor_verify_unlock", {
    p_device_token: deviceToken,
    p_staff_id: staffId || null,
    p_employee_number: employeeNumber || null,
    p_pin: pin,
  });
  if (error) {
    logError("floor.unlock", error, { action: "verify_unlock" });
    return floorErrorResponse("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) {
    const code = String(result.error ?? "not_recognized");
    // A roster PIN miss says how many tries are left before the 15 minute lock
    // (spec 40 §6 screen 2). The employee-number path stays generic: it must
    // not confirm that a typed number belongs to someone.
    const triesLeft = Number(result.tries_left);
    if (code === "not_recognized" && staffId && Number.isInteger(triesLeft) && triesLeft >= 0) {
      return floorErrorResponse(code, { tries_left: triesLeft });
    }
    return floorErrorResponse(code);
  }

  const unlockId = String(result.unlock_id ?? "");
  const userId = String(result.user_id ?? "");
  const email = typeof result.email === "string" ? result.email : "";
  const idle = Number(result.idle_lock_minutes);
  const payload: FloorUnlockResponse = {
    unlock_id: unlockId,
    user_id: userId,
    idle_lock_minutes: Number.isFinite(idle) && idle > 0 ? idle : 3,
    display_name: String(result.display_name ?? ""),
    role_label: String(result.role_label ?? ""),
    clocked_in_at: typeof result.clocked_in_at === "string" ? result.clocked_in_at : null,
    on_clock: result.on_clock === true,
  };

  const response = floorJson(payload);
  const requestCookies = request.cookies.getAll();
  let minted: Awaited<ReturnType<typeof mintFloorSession>>;
  try {
    minted = email && userId && unlockId
      ? await mintFloorSession({ email, userId, requestCookies, response })
      : { ok: false, stage: "link" };
  } catch (mintError) {
    logError("floor.unlock", mintError, { action: "mint_session", unlockId });
    minted = { ok: false, stage: "verify" };
  }
  if (minted.ok) return response;

  logError("floor.unlock", new Error(`floor session mint failed at ${minted.stage}`), { action: "mint_session", unlockId });
  // 'switch' is the closest reason floor_end_unlock accepts: the unlock ends
  // before anyone used it. The ledger keeps the row and its end.
  if (unlockId) {
    const { error: endError } = await admin.rpc("floor_end_unlock", { p_device_token: deviceToken, p_unlock_id: unlockId, p_reason: "switch" });
    if (endError) logError("floor.unlock", endError, { action: "end_unlock_after_mint_failure", unlockId });
  }
  const failed = floorErrorResponse("unavailable");
  clearHavenSessionCookies(requestCookies, failed);
  return failed;
}
