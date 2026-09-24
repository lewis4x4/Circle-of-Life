import { KIOSK_DEVICE_HEADER, type KioskSignOutResponse } from "@/lib/kiosk/contract";
import { kioskVisitorError, kioskVisitorJson } from "@/lib/kiosk/server";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isRecord } from "@/lib/timeclock/server";

/**
 * POST /api/kiosk/visitor/sign-out: a visitor signs themselves out at the
 * kiosk, once (spec 40 §7). Recorded as kiosk_self.
 */
export async function POST(request: Request) {
  const deviceToken = request.headers.get(KIOSK_DEVICE_HEADER)?.trim() ?? "";
  if (!deviceToken) return kioskVisitorError("device_unknown");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return kioskVisitorError("invalid_input");
  }
  const entryId = isRecord(body) && typeof body.entry_id === "string" ? body.entry_id : "";
  if (!UUID_STRING_RE.test(entryId)) return kioskVisitorError("invalid_input");

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return kioskVisitorError("unavailable");
  }

  const { data, error } = await admin.rpc("visitor_kiosk_sign_out", { p_device_token: deviceToken, p_entry_id: entryId });
  if (error) {
    logError("kiosk.visitor.sign_out", error, { action: "sign_out" });
    return kioskVisitorError("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) return kioskVisitorError(String(result.error ?? "unavailable"));
  const response: KioskSignOutResponse = {
    checked_in_at: String(result.checked_in_at),
    checked_out_at: String(result.checked_out_at),
    display_name: String(result.display_name ?? ""),
  };
  return kioskVisitorJson(response);
}
