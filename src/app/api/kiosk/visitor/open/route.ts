import type { NextRequest } from "next/server";

import {
  KIOSK_DEVICE_HEADER,
  KIOSK_SIGN_OUT_MAX_MATCHES,
  KIOSK_SIGN_OUT_MIN_LETTERS,
  kioskPrefixLetterCount,
  type KioskOpenMatchesResponse,
  type KioskOpenVisit,
} from "@/lib/kiosk/contract";
import { kioskVisitorError, kioskVisitorJson } from "@/lib/kiosk/server";
import { logError } from "@/lib/observability/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isRecord } from "@/lib/timeclock/server";

function visit(row: unknown): KioskOpenVisit | null {
  if (!isRecord(row) || typeof row.entry_id !== "string") return null;
  return {
    entry_id: row.entry_id,
    display_name: String(row.display_name ?? ""),
    type_label: String(row.type_label ?? ""),
    checked_in_at: String(row.checked_in_at ?? ""),
  };
}

/**
 * GET /api/kiosk/visitor/open?prefix=: open visits at this kiosk's building
 * whose visitor name starts with the prefix (spec 40 §7). Nothing before 3
 * letters (answered here without a database call), at most 5, first name and
 * last initial only.
 */
export async function GET(request: NextRequest) {
  const deviceToken = request.headers.get(KIOSK_DEVICE_HEADER)?.trim() ?? "";
  if (!deviceToken) return kioskVisitorError("device_unknown");

  const prefix = (request.nextUrl.searchParams.get("prefix") ?? "").trim().slice(0, 60);
  if (kioskPrefixLetterCount(prefix) < KIOSK_SIGN_OUT_MIN_LETTERS) {
    const empty: KioskOpenMatchesResponse = { matches: [] };
    return kioskVisitorJson(empty);
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return kioskVisitorError("unavailable");
  }

  const { data, error } = await admin.rpc("visitor_kiosk_open_matches", { p_device_token: deviceToken, p_prefix: prefix });
  if (error) {
    logError("kiosk.visitor.open", error, { action: "open_matches" });
    return kioskVisitorError("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) return kioskVisitorError(String(result.error ?? "unavailable"));
  const matches = Array.isArray(result.matches)
    ? result.matches.map(visit).filter((m): m is KioskOpenVisit => m !== null).slice(0, KIOSK_SIGN_OUT_MAX_MATCHES)
    : [];
  const response: KioskOpenMatchesResponse = { matches };
  return kioskVisitorJson(response);
}
