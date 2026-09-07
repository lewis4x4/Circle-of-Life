import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { grantFacilityAccessSchema } from "@/lib/validation/user-management";
import { commitExpansiveUserAccess, commitRestrictiveUserAccess } from "@/lib/admin/user-access-lifecycle";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";

interface RouteContext { params: Promise<{ id: string; facilityId?: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApiActor({ allowedRoles: ["owner", "org_admin", "facility_admin", "manager"] });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const { id } = await context.params;
  if (!UUID_STRING_RE.test(id)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = grantFacilityAccessSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 422 });
  try {
    // The atomic command checks current actor/target/facility and resolves a
    // same-key receipt BEFORE testing whether the grant already exists.
    const result = await commitExpansiveUserAccess(actor.admin, {
      targetUserId: id, actingUserId: actor.id, organizationId: actor.organization_id,
      operation: "grant_facility", facilityIds: [parsed.data.facility_id],
      primaryFacilityId: parsed.data.is_primary ? parsed.data.facility_id : undefined,
      requestKey: request.headers.get("idempotency-key"),
    });
    return NextResponse.json({ data: result, sync_status: result.sync_status },
      { status: result.sync_status === "synchronized" ? 201 : 202 });
  } catch (error) {
    logError("admin.users.facility_access", error, { action: "grant", targetUserId: id });
    return NextResponse.json({ error: "Facility access command could not complete. Refresh current access before retrying." }, { status: 409 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApiActor({ allowedRoles: ["owner", "org_admin", "facility_admin", "manager"] });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const { id, facilityId } = await context.params;
  if (!UUID_STRING_RE.test(id) || !facilityId || !UUID_STRING_RE.test(facilityId)) {
    return NextResponse.json({ error: "Invalid user or facility ID" }, { status: 400 });
  }
  try {
    // A successful last-facility revoke removes the shared scope. The database
    // may still return its authenticated same-actor receipt on a lost-response retry.
    const result = await commitRestrictiveUserAccess(actor.admin, {
      targetUserId: id, actingUserId: actor.id, organizationId: actor.organization_id,
      operation: "revoke_facility", facilityId, requestKey: request.headers.get("idempotency-key"),
    });
    return result.sync_status === "synchronized" ? new NextResponse(null, { status: 204 }) :
      NextResponse.json({ data: result, sync_status: result.sync_status }, { status: 202 });
  } catch (error) {
    logError("admin.users.facility_access", error, { action: "revoke", targetUserId: id });
    return NextResponse.json({ error: "Facility access command could not complete. Refresh current access before retrying." }, { status: 409 });
  }
}
