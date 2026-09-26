import type { NextRequest } from "next/server";

import {
  KIOSK_DEVICE_HEADER,
  KIOSK_RESIDENT_MAX_MATCHES,
  KIOSK_RESIDENT_MIN_LETTERS,
  kioskPrefixLetterCount,
  type KioskResidentMatch,
  type KioskResidentMatchesResponse,
} from "@/lib/kiosk/contract";
import { kioskVisitorError, kioskVisitorJson } from "@/lib/kiosk/server";
import { logError } from "@/lib/observability/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isRecord } from "@/lib/timeclock/server";

function resident(row: unknown): KioskResidentMatch | null {
  if (!isRecord(row) || typeof row.resident_id !== "string" || typeof row.display_name !== "string") return null;
  return {
    resident_id: row.resident_id,
    display_name: row.display_name,
    room: typeof row.room === "string" && row.room.trim() ? row.room.trim() : null,
  };
}

/**
 * GET /api/kiosk/visitor/residents?prefix=: current residents of this kiosk's
 * building whose name starts with the prefix, for "Resident you are seeing".
 * Nothing before 3 letters (answered here without a database call), at most 6,
 * first name and last initial with the room. The census is never listed.
 */
export async function GET(request: NextRequest) {
  const deviceToken = request.headers.get(KIOSK_DEVICE_HEADER)?.trim() ?? "";
  if (!deviceToken) return kioskVisitorError("device_unknown");

  const prefix = (request.nextUrl.searchParams.get("prefix") ?? "").trim().slice(0, 60);
  if (kioskPrefixLetterCount(prefix) < KIOSK_RESIDENT_MIN_LETTERS) {
    const empty: KioskResidentMatchesResponse = { matches: [] };
    return kioskVisitorJson(empty);
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return kioskVisitorError("unavailable");
  }

  const { data, error } = await admin.rpc("visitor_kiosk_resident_matches", { p_device_token: deviceToken, p_prefix: prefix });
  if (error) {
    logError("kiosk.visitor.residents", error, { action: "resident_matches" });
    return kioskVisitorError("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) return kioskVisitorError(String(result.error ?? "unavailable"));
  const matches = Array.isArray(result.matches)
    ? result.matches.map(resident).filter((m): m is KioskResidentMatch => m !== null).slice(0, KIOSK_RESIDENT_MAX_MATCHES)
    : [];
  const response: KioskResidentMatchesResponse = { matches };
  return kioskVisitorJson(response);
}
