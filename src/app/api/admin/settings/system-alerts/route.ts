import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { alertError, alertRpc, settingsInput } from "@/lib/system-alerts/server";
export async function GET() {
  const auth = await requireAdminApiActor({ allowedRoles: ["owner", "org_admin"] });
  if ("response" in auth) return auth.response;
  const { data, error } = await alertRpc("system_alert_settings_get");
  return error ? alertError(error) : NextResponse.json({ ...(data as Record<string, unknown>), emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.SYSTEM_ALERT_EMAIL_FROM) }, { headers: { "Cache-Control": "no-store" } });
}
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApiActor({ allowedRoles: ["owner", "org_admin"] });
  if ("response" in auth) return auth.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Provide valid, unique recipients and alert types." }, { status: 422 });
  const value = parsed.data;
  const { data, error } = await alertRpc("system_alert_settings_update", { p_expected_version: value.expectedVersion, p_enabled: value.enabled, p_recipients: value.recipients, p_alert_kinds: value.alertKinds });
  return error ? alertError(error) : NextResponse.json(data);
}
