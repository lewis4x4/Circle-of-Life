import { FLOOR_DEVICE_HEADER, FLOOR_REPLAY_MAX_ITEMS, type FloorReplayResponse, type FloorReplayResult } from "@/lib/floor/contract";
import { parseReplayItem, replayOne } from "@/lib/floor/replay-server";
import { floorErrorResponse, floorJson } from "@/lib/floor/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isRecord } from "@/lib/timeclock/server";

/**
 * POST /api/floor/replay: offline rounding checks and care events queued on
 * this floor tablet, written as their owner after the tablet locked (spec 40
 * §1 "Offline", §4). Authenticates with the device token and the unlock each
 * item was captured under, never with a session, so it works while someone
 * else is unlocked. The replay wrappers call the same writers the signed-in
 * routes call and re-check the owner's current authority, so a replay never
 * writes what the owner could not have written signed in.
 *
 * Per item: sent (remove it), rejected (refused for good, remove it), retry
 * (not written, keep it).
 */
export async function POST(request: Request) {
  const deviceToken = request.headers.get(FLOOR_DEVICE_HEADER)?.trim() ?? "";
  if (!deviceToken) return floorErrorResponse("device_unknown");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return floorErrorResponse("invalid_input");
  }
  if (!isRecord(body) || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > FLOOR_REPLAY_MAX_ITEMS) {
    return floorErrorResponse("invalid_input");
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return floorErrorResponse("unavailable");
  }

  const results: FloorReplayResult[] = [];
  for (const raw of body.items) {
    const parsed = parseReplayItem(raw);
    if ("reject" in parsed) {
      if (parsed.clientId) results.push({ client_id: parsed.clientId, status: "rejected", error: parsed.reject });
      continue;
    }
    results.push(await replayOne(admin, deviceToken, parsed.item));
  }
  const response: FloorReplayResponse = { results };
  return floorJson(response);
}
