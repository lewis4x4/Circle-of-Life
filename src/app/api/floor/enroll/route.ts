import { logError } from "@/lib/observability/logger";
import type { FloorEnrollResponse } from "@/lib/floor/contract";
import { floorErrorResponse, floorJson } from "@/lib/floor/server";
import { checkFailureRateLimit, clearFailureRateLimit, recordFailureRateLimit } from "@/lib/security/in-memory-failure-rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientAddress, isRecord } from "@/lib/timeclock/server";

// Same per-address budget as the kiosk enroll route; a separate key so one
// cannot spend the other's.
const ENROLL_LIMIT = { maxFailures: 10, windowMs: 15 * 60 * 1000 };
const CODE_RE = /^[A-Z0-9]{8}$/;

/**
 * POST /api/floor/enroll: exchange a one time floor-tablet enrollment code for
 * a device token (spec 40 §4). No session: the code is the credential. A
 * kiosk-kind code is `code_invalid` here and is not consumed.
 */
export async function POST(request: Request) {
  const limiterKey = `floor-enroll:${clientAddress(request)}`;
  const limit = checkFailureRateLimit(limiterKey, ENROLL_LIMIT);
  if (!limit.allowed) {
    return floorJson({ error: "device_throttled" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return floorErrorResponse("invalid_input");
  }
  if (!isRecord(body)) return floorErrorResponse("invalid_input");
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!CODE_RE.test(code) || label.length < 1 || label.length > 60) {
    return floorErrorResponse("invalid_input");
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return floorErrorResponse("unavailable");
  }

  const { data, error } = await admin.rpc("timeclock_enroll_device", { p_code: code, p_label: label, p_device_kind: "floor" });
  if (error) {
    logError("floor.enroll", error, { action: "enroll_device" });
    return floorErrorResponse("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) {
    recordFailureRateLimit(limiterKey, ENROLL_LIMIT);
    return floorErrorResponse("code_invalid");
  }
  clearFailureRateLimit(limiterKey);
  const response: FloorEnrollResponse = {
    device_id: String(result.device_id),
    token: String(result.token),
    facility_id: String(result.facility_id),
    facility_name: String(result.facility_name ?? ""),
    device_label: label,
  };
  return floorJson(response);
}
