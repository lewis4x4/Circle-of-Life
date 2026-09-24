import { NextResponse, type NextRequest } from "next/server";

import { FLOOR_DEVICE_HEADER, isFloorLockReason } from "@/lib/floor/contract";
import { endFloorSession, floorErrorResponse, NO_STORE } from "@/lib/floor/server";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isRecord } from "@/lib/timeclock/server";

/**
 * POST /api/floor/lock: the tablet locks (screen dark, idle, Switch). Ends the
 * unlock with the device token, then signs this tablet's session out and
 * clears its cookies. Always answers 204 once the body is well formed: the
 * tablet must reach its lock screen even when the session already expired,
 * the unlock already ended, or the database is unreachable (the heartbeat and
 * the 12-hour cap end the row then).
 */
export async function POST(request: NextRequest) {
  const deviceToken = request.headers.get(FLOOR_DEVICE_HEADER)?.trim() ?? "";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return floorErrorResponse("invalid_input");
  }
  if (!isRecord(body)) return floorErrorResponse("invalid_input");
  const unlockId = typeof body.unlock_id === "string" ? body.unlock_id : "";
  const reason = body.reason;
  if (!isFloorLockReason(reason) || (unlockId !== "" && !UUID_STRING_RE.test(unlockId))) {
    return floorErrorResponse("invalid_input");
  }

  if (deviceToken && unlockId) {
    try {
      const { data, error } = await createServiceRoleClient().rpc("floor_end_unlock", {
        p_device_token: deviceToken,
        p_unlock_id: unlockId,
        p_reason: reason,
      });
      if (error) logError("floor.lock", error, { action: "end_unlock", unlockId });
      else if (isRecord(data) && data.ok !== true && data.error !== "unknown") {
        logError("floor.lock", new Error(`floor_end_unlock refused: ${String(data.error)}`), { action: "end_unlock", unlockId });
      }
    } catch (endError) {
      logError("floor.lock", endError, { action: "end_unlock", unlockId });
    }
  }

  const response = new NextResponse(null, { status: 204, headers: NO_STORE });
  await endFloorSession(request.cookies.getAll(), response);
  return response;
}
