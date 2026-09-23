import type { NextRequest } from "next/server";

import { FLOOR_DEVICE_HEADER, type FloorHeartbeatResponse, type FloorInactiveReason } from "@/lib/floor/contract";
import { endFloorSession, floorErrorResponse, floorJson } from "@/lib/floor/server";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isRecord } from "@/lib/timeclock/server";

const INACTIVE_REASONS: ReadonlySet<string> = new Set<FloorInactiveReason>([
  "sleep", "idle", "switch", "clocked_out", "device_revoked", "max_age", "new_unlock", "unknown",
]);

/**
 * GET /api/floor/heartbeat?unlock_id=: every 60 seconds while unlocked (spec
 * 40 §1). Inactive once the unlock ended, the tablet was revoked, 12 hours
 * passed, or the person clocked out; the session cookies are cleared on that
 * same response so the tablet is signed out even if the page never calls lock.
 */
export async function GET(request: NextRequest) {
  const deviceToken = request.headers.get(FLOOR_DEVICE_HEADER)?.trim() ?? "";
  const unlockId = request.nextUrl.searchParams.get("unlock_id") ?? "";
  if (!UUID_STRING_RE.test(unlockId)) return floorErrorResponse("invalid_input");

  let result: Record<string, unknown> = { active: false, reason: "device_revoked" };
  if (deviceToken) {
    let admin: ReturnType<typeof createServiceRoleClient>;
    try {
      admin = createServiceRoleClient();
    } catch {
      return floorErrorResponse("unavailable");
    }
    const { data, error } = await admin.rpc("floor_heartbeat", { p_device_token: deviceToken, p_unlock_id: unlockId });
    if (error) {
      // Not an answer about the unlock: keep the tablet as it is and try again next beat.
      logError("floor.heartbeat", error, { action: "heartbeat", unlockId });
      return floorErrorResponse("unavailable");
    }
    result = isRecord(data) ? data : result;
  }

  if (result.active === true) {
    const payload: FloorHeartbeatResponse = { active: true, reason: null };
    return floorJson(payload);
  }
  const reason = String(result.reason ?? "unknown");
  const payload: FloorHeartbeatResponse = {
    active: false,
    reason: INACTIVE_REASONS.has(reason) ? (reason as FloorInactiveReason) : "unknown",
  };
  const response = floorJson(payload);
  await endFloorSession(request.cookies.getAll(), response);
  return response;
}
