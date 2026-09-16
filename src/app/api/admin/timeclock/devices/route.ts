import { NextResponse } from "next/server";

import { requireAdminApiActor, requireFacilityAccess } from "@/lib/admin/api-auth";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { isRecord } from "@/lib/timeclock/server";

const MANAGER_ROLES = ["owner", "org_admin", "facility_admin"] as const;
const SETTINGS_ROLES = ["owner", "org_admin"] as const;

function rpcErrorResponse(message: string): NextResponse {
  if (/forbidden|not authenticated/.test(message)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  if (/not found/.test(message)) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  return NextResponse.json({ error: "Could not update timeclock devices" }, { status: 500 });
}

/** GET /api/admin/timeclock/devices?facility_id= — flag plus device list without token hashes. */
export async function GET(request: Request) {
  const auth = await requireAdminApiActor({ allowedRoles: MANAGER_ROLES });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const facilityId = new URL(request.url).searchParams.get("facility_id") ?? "";
  if (!UUID_STRING_RE.test(facilityId)) return NextResponse.json({ error: "A valid facility_id is required" }, { status: 400 });
  const access = await requireFacilityAccess(actor, facilityId);
  if ("response" in access) return access.response;

  const [flag, devices] = await Promise.all([
    actor.client.from("timeclock_facility_settings").select("timeclock_enabled").eq("facility_id", facilityId).maybeSingle(),
    actor.client.rpc("timeclock_list_devices", { p_facility_id: facilityId }),
  ]);
  if (flag.error) {
    logError("timeclock.devices", flag.error, { action: "flag" });
    return NextResponse.json({ error: "Could not load timeclock settings" }, { status: 500 });
  }
  if (devices.error) {
    logError("timeclock.devices", devices.error, { action: "list" });
    return rpcErrorResponse(devices.error.message ?? "");
  }
  return NextResponse.json(
    { enabled: Boolean(flag.data?.timeclock_enabled), devices: devices.data ?? [], can_manage: (SETTINGS_ROLES as readonly string[]).includes(actor.app_role) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * POST /api/admin/timeclock/devices — enroll_code (returns the one time code),
 * revoke (device_id), set_enabled (enabled). Owner and org_admin only.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApiActor({ allowedRoles: SETTINGS_ROLES });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const facilityId = typeof body.facility_id === "string" ? body.facility_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!UUID_STRING_RE.test(facilityId) || !["enroll_code", "revoke", "set_enabled"].includes(action)) {
    return NextResponse.json({ error: "A valid facility_id and action are required" }, { status: 400 });
  }
  const access = await requireFacilityAccess(actor, facilityId);
  if ("response" in access) return access.response;

  if (action === "enroll_code") {
    const { data, error } = await actor.client.rpc("timeclock_create_enrollment_code", { p_facility_id: facilityId });
    if (error) {
      logError("timeclock.devices", error, { action });
      return rpcErrorResponse(error.message ?? "");
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "revoke") {
    const deviceId = typeof body.device_id === "string" ? body.device_id : "";
    if (!UUID_STRING_RE.test(deviceId)) return NextResponse.json({ error: "A valid device_id is required" }, { status: 400 });
    const { error } = await actor.client.rpc("timeclock_revoke_device", { p_device_id: deviceId });
    if (error) {
      logError("timeclock.devices", error, { action });
      return rpcErrorResponse(error.message ?? "");
    }
    return NextResponse.json({ ok: true });
  }

  const enabled = body.enabled === true;
  const { error } = await actor.client
    .from("timeclock_facility_settings")
    .upsert({ organization_id: actor.organization_id, facility_id: facilityId, timeclock_enabled: enabled, updated_by: actor.id }, { onConflict: "organization_id,facility_id" });
  if (error) {
    logError("timeclock.devices", error, { action });
    return NextResponse.json({ error: "Could not update the timeclock flag" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, enabled });
}
