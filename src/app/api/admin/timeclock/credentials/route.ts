import { randomInt } from "node:crypto";

import { NextResponse } from "next/server";

import { requireAdminApiActor, requireFacilityAccess } from "@/lib/admin/api-auth";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { badgeHmacConfigured, badgeLookupHmac, isRecord } from "@/lib/timeclock/server";

const MANAGER_ROLES = ["owner", "org_admin", "facility_admin"] as const;
const ACTIONS = new Set(["create", "set_number", "reset_pin", "set_badge", "clear_badge", "unlock"]);

type Actor = Extract<Awaited<ReturnType<typeof requireAdminApiActor>>, { actor: unknown }>["actor"];

async function staffFacility(actor: Actor, staffId: string): Promise<string | null> {
  const { data } = await actor.admin.from("staff").select("facility_id, organization_id").eq("id", staffId).is("deleted_at", null).maybeSingle();
  if (!data || data.organization_id !== actor.organization_id) return null;
  return data.facility_id;
}

function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function generateTimeclockId(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

function rpcErrorResponse(message: string): NextResponse {
  if (/employee_number_taken/.test(message)) return NextResponse.json({ error: "employee_number_taken" }, { status: 409 });
  if (/badge_taken/.test(message)) return NextResponse.json({ error: "badge_taken" }, { status: 409 });
  if (/credential exists/.test(message)) return NextResponse.json({ error: "credential_exists" }, { status: 409 });
  if (/no credential/.test(message)) return NextResponse.json({ error: "no_credential" }, { status: 404 });
  if (/inactive_staff/.test(message)) return NextResponse.json({ error: "inactive_staff" }, { status: 409 });
  if (/invalid/.test(message)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  if (/forbidden|not authenticated/.test(message)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  return NextResponse.json({ error: "Could not update timeclock access" }, { status: 500 });
}

/** GET /api/admin/timeclock/credentials?staff_id= — status only, never a hash. */
export async function GET(request: Request) {
  const auth = await requireAdminApiActor({ allowedRoles: MANAGER_ROLES });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const staffId = new URL(request.url).searchParams.get("staff_id") ?? "";
  if (!UUID_STRING_RE.test(staffId)) return NextResponse.json({ error: "A valid staff_id is required" }, { status: 400 });
  const facilityId = await staffFacility(actor, staffId);
  if (!facilityId) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const access = await requireFacilityAccess(actor, facilityId);
  if ("response" in access) return access.response;

  const { data, error } = await actor.client.rpc("timeclock_credential_status", { p_staff_id: staffId });
  if (error) {
    logError("timeclock.credentials", error, { action: "status" });
    return rpcErrorResponse(error.message ?? "");
  }
  return NextResponse.json({ status: data, badge_secret_configured: badgeHmacConfigured() }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/admin/timeclock/credentials — create, set_number, reset_pin,
 * set_badge, clear_badge, unlock. The PIN is generated here, hashed in the
 * database, and returned exactly once. The badge value is HMAC'd here and
 * never stored or logged.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApiActor({ allowedRoles: MANAGER_ROLES });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const staffId = typeof body.staff_id === "string" ? body.staff_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!UUID_STRING_RE.test(staffId) || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "A valid staff_id and action are required" }, { status: 400 });
  }
  const facilityId = await staffFacility(actor, staffId);
  if (!facilityId) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const access = await requireFacilityAccess(actor, facilityId);
  if ("response" in access) return access.response;

  if (action === "unlock") {
    const { data, error } = await actor.client.rpc("timeclock_unlock_credential", { p_staff_id: staffId });
    if (error) return rpcErrorResponse(error.message ?? "");
    return NextResponse.json({ status: data }, { headers: { "Cache-Control": "no-store" } });
  }

  let mode: string = action;
  let pin: string | null = null;
  let employeeNumber: string | null = null;
  let badgeHmac: string | null = null;
  let generatedId = false;

  if (action === "create") {
    employeeNumber = typeof body.employee_number === "string" ? body.employee_number.trim() : "";
    if (!employeeNumber) {
      employeeNumber = generateTimeclockId();
      generatedId = true;
    }
    pin = generatePin();
  } else if (action === "set_number") {
    employeeNumber = typeof body.employee_number === "string" ? body.employee_number.trim() : "";
    if (!employeeNumber) return NextResponse.json({ error: "employee_number is required" }, { status: 400 });
  } else if (action === "reset_pin") {
    mode = "set_pin";
    pin = generatePin();
  } else if (action === "set_badge") {
    const badge = typeof body.badge === "string" ? body.badge.trim() : "";
    if (!badge) return NextResponse.json({ error: "badge is required" }, { status: 400 });
    if (!badgeHmacConfigured()) return NextResponse.json({ error: "badge_secret_missing" }, { status: 409 });
    badgeHmac = badgeLookupHmac(badge);
  }

  for (let attempt = 0; attempt < (generatedId ? 5 : 1); attempt += 1) {
    const { data, error } = await actor.client.rpc("timeclock_set_credentials", {
      p_staff_id: staffId,
      p_mode: mode,
      p_employee_number: employeeNumber,
      p_pin: pin,
      p_badge_lookup_hmac: badgeHmac,
    });
    if (!error) {
      return NextResponse.json({ status: data, pin }, { headers: { "Cache-Control": "no-store" } });
    }
    const numberTaken = /employee_number_taken/.test(error.message ?? "") ||
      (error.code === "23505" && /employee_number/.test(error.message ?? ""));
    if (generatedId && numberTaken && attempt < 4) {
      employeeNumber = generateTimeclockId();
      continue;
    }
    logError("timeclock.credentials", error, { action });
    return numberTaken ? rpcErrorResponse("employee_number_taken") : rpcErrorResponse(error.message ?? "");
  }
  return NextResponse.json({ error: "Could not update timeclock access" }, { status: 500 });
}
