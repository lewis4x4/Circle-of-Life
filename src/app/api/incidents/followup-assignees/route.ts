import { NextResponse } from "next/server";

import {
  actorCanAccessFacility,
  actorHasOrgWideFacilityScope,
  requireAdminApiActor,
} from "@/lib/admin/api-auth";
import { ADMIN_ELIGIBLE_ROLES, type AppRole } from "@/lib/rbac";

const ASSIGNEE_ROLES = Array.from(ADMIN_ELIGIBLE_ROLES) as AppRole[];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const facilityId = url.searchParams.get("facilityId")?.trim();

  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  }

  const actorResult = await requireAdminApiActor();
  if ("response" in actorResult) {
    return actorResult.response;
  }

  const { actor } = actorResult;
  const canAccessFacility = await actorCanAccessFacility(actor, facilityId);
  if (!canAccessFacility) {
    return NextResponse.json({ error: "Facility access denied" }, { status: 403 });
  }

  let userIds: string[] | null = null;

  if (!actorHasOrgWideFacilityScope(actor)) {
    const { data: facilityAccessRows, error: facilityAccessError } = await actor.admin
      .from("user_facility_access")
      .select("user_id")
      .eq("organization_id", actor.organization_id)
      .eq("facility_id", facilityId)
      .is("revoked_at", null);

    if (facilityAccessError) {
      return NextResponse.json({ error: facilityAccessError.message }, { status: 500 });
    }

    userIds = Array.from(
      new Set(
        [
          actor.id,
          ...(facilityAccessRows ?? []).map((row) => row.user_id).filter((value): value is string => typeof value === "string"),
        ],
      ),
    );
  }

  let query = actor.admin
    .from("user_profiles")
    .select("id, full_name, email, app_role")
    .eq("organization_id", actor.organization_id)
    .is("deleted_at", null)
    .eq("is_active", true)
    .in("app_role", ASSIGNEE_ROLES)
    .order("full_name", { ascending: true });

  if (userIds) {
    query = query.in("id", userIds);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    assigneeOptions: (data ?? []).map((row) => ({
      id: row.id,
      label: row.full_name || row.email || row.id,
      appRole: row.app_role,
    })),
  });
}
