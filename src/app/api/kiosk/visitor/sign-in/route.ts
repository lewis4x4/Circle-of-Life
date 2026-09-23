import { KIOSK_DEVICE_HEADER, isKioskVisitorKind, validateKioskSignIn, type KioskSignInResponse } from "@/lib/kiosk/contract";
import { kioskVisitorError, kioskVisitorJson } from "@/lib/kiosk/server";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isRecord } from "@/lib/timeclock/server";

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * POST /api/kiosk/visitor/sign-in: a visitor, provider, vendor or inspector
 * signs the visitor log at the front-door kiosk (spec 40 §7). No session: the
 * kiosk device token is the credential. Idempotent on client_entry_id.
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
  if (!isRecord(body) || !isKioskVisitorKind(body.kind)) return kioskVisitorError("invalid_input");
  const clientEntryId = typeof body.client_entry_id === "string" ? body.client_entry_id : "";
  if (!UUID_STRING_RE.test(clientEntryId)) return kioskVisitorError("invalid_input");

  const validated = validateKioskSignIn(body.kind, {
    name: typeof body.name === "string" ? body.name : "",
    phone: optionalText(body.phone),
    company: optionalText(body.company),
    visiting_name: optionalText(body.visiting_name),
    purpose: optionalText(body.purpose),
    symptoms: typeof body.symptoms === "boolean" ? body.symptoms : null,
  });
  if (!validated.ok) return kioskVisitorError("invalid_input", validated.errors);
  const form = validated.value;

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return kioskVisitorError("unavailable");
  }

  const { data, error } = await admin.rpc("visitor_kiosk_sign_in", {
    p_device_token: deviceToken,
    p_client_entry_id: clientEntryId,
    p_visitor_type: form.visitor_type,
    p_visitor_name: form.name,
    p_visitor_phone: form.phone,
    p_visitor_company: form.company,
    p_visiting_name_text: form.visiting_name,
    p_purpose: form.purpose,
    p_symptoms_reported: form.symptoms,
  });
  if (error) {
    logError("kiosk.visitor.sign_in", error, { action: "sign_in", kind: body.kind });
    return kioskVisitorError("unavailable");
  }
  const result = isRecord(data) ? data : {};
  if (result.ok !== true) return kioskVisitorError(String(result.error ?? "unavailable"));
  const response: KioskSignInResponse = { entry_id: String(result.entry_id), checked_in_at: String(result.checked_in_at) };
  return kioskVisitorJson(response);
}
