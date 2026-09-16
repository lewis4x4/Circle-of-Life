import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { checkFailureRateLimit, clearFailureRateLimit, recordFailureRateLimit } from "@/lib/security/in-memory-failure-rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { KioskEnrollResponse } from "@/lib/timeclock/kiosk-contract";
import { clientAddress, isRecord, kioskErrorResponse } from "@/lib/timeclock/server";

const ENROLL_LIMIT = { maxFailures: 10, windowMs: 15 * 60 * 1000 };
const CODE_RE = /^[A-Z0-9]{8}$/;

/**
 * POST /api/kiosk/timeclock/enroll — exchange a one time enrollment code for a
 * device token (spec 37 §5). No session: the code is the credential. Failed
 * attempts are rate limited per client address so an 8 character code cannot
 * be guessed inside its 15 minute life.
 */
export async function POST(request: Request) {
  const limiterKey = `timeclock-enroll:${clientAddress(request)}`;
  const limit = checkFailureRateLimit(limiterKey, ENROLL_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json({ error: "device_throttled" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return kioskErrorResponse("invalid_input");
  }
  if (!isRecord(body)) return kioskErrorResponse("invalid_input");
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!CODE_RE.test(code) || label.length < 1 || label.length > 60) {
    return kioskErrorResponse("invalid_input");
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return kioskErrorResponse("unavailable");
  }

  const { data, error } = await admin.rpc("timeclock_enroll_device", { p_code: code, p_label: label });
  if (error) {
    logError("timeclock.enroll", error, { action: "enroll_device" });
    return kioskErrorResponse("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) {
    recordFailureRateLimit(limiterKey, ENROLL_LIMIT);
    return kioskErrorResponse("code_invalid");
  }
  clearFailureRateLimit(limiterKey);
  const response: KioskEnrollResponse = {
    device_id: String(result.device_id),
    token: String(result.token),
    facility_id: String(result.facility_id),
    facility_name: String(result.facility_name ?? ""),
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
