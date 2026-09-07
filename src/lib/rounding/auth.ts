import { NextResponse } from "next/server";

import {
  requireCurrentApiActor,
  revalidateCurrentApiActor,
  type CurrentApiActor,
} from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";
import type { AppRole } from "@/lib/rbac";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

const ROUNDING_MANAGER_ROLES = ["owner", "org_admin", "facility_admin", "nurse"] as const satisfies readonly AppRole[];

export type RoundingRequestContext = {
  actor: CurrentApiActor;
  admin: CurrentApiActor["admin"];
  userId: string;
  organizationId: string;
  appRole: AppRole;
  currentStaffId: string | null;
  sessionId: string;
  authClaimVersion: number | null;
};

export type RoundingRequestContextResult =
  | { context: RoundingRequestContext }
  | { response: NextResponse };

async function resolveCurrentStaffId(actor: CurrentApiActor, facilityId?: string): Promise<string | null> {
  let query = actor.admin
    .from("staff")
    .select("id")
    .eq("user_id", actor.id)
    .eq("organization_id", actor.organizationId)
    .eq("employment_status", "active")
    .is("deleted_at", null);
  if (facilityId) query = query.eq("facility_id", facilityId);
  const { data, error } = await query.maybeSingle();

  if (error) {
    logError("rounding.auth", error, { action: "resolve_current_staff" });
    return null;
  }
  return data?.id ?? null;
}

async function buildContext(actor: CurrentApiActor, facilityId?: string): Promise<RoundingRequestContext | null> {
  const { data, error } = await actor.client.auth.getClaims();
  const claims = data?.claims;
  const sessionId = typeof claims?.session_id === "string" ? claims.session_id : null;
  const rawVersion = claims?.auth_claim_version;
  const authClaimVersion = rawVersion == null
    ? null
    : typeof rawVersion === "number" && Number.isSafeInteger(rawVersion) && rawVersion >= 1
      ? rawVersion
      : null;
  if (error || claims?.sub !== actor.id || !sessionId || (rawVersion != null && authClaimVersion == null)) {
    return null;
  }
  return {
    actor,
    admin: actor.admin,
    userId: actor.id,
    organizationId: actor.organizationId,
    appRole: actor.appRole,
    currentStaffId: await resolveCurrentStaffId(actor, facilityId),
    sessionId,
    authClaimVersion,
  };
}

/** Resolve signed identity and live authority before exposing service-role access. */
export async function getRoundingRequestContext(options?: {
  managerOnly?: boolean;
}): Promise<RoundingRequestContextResult> {
  const auth = await requireCurrentApiActor({
    allowedRoles: options?.managerOnly ? ROUNDING_MANAGER_ROLES : undefined,
    scope: "rounding.auth",
  });
  if ("response" in auth) return auth;
  const context = await buildContext(auth.actor);
  if (!context) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { context };
}

/** Refresh current role/org/session/staff and optional facility grant before mutation. */
export async function revalidateRoundingRequestContext(
  context: RoundingRequestContext,
  options?: { managerOnly?: boolean; facilityId?: string },
): Promise<RoundingRequestContextResult> {
  const auth = await revalidateCurrentApiActor(context.actor, {
    allowedRoles: options?.managerOnly ? ROUNDING_MANAGER_ROLES : undefined,
    scope: "rounding.auth.revalidate",
  });
  if ("response" in auth) return auth;

  const refreshed = await buildContext(auth.actor, options?.facilityId);
  if (!refreshed) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (options?.facilityId && !(await assertRoundingFacilityAccess(refreshed, options.facilityId))) {
    return {
      response: NextResponse.json({ error: "No access to this facility" }, { status: 403 }),
    };
  }
  return { context: refreshed };
}

export function isRoundingManagerRole(appRole: string | null | undefined) {
  return !!appRole && (ROUNDING_MANAGER_ROLES as readonly string[]).includes(appRole);
}

export async function assertRoundingFacilityAccess(
  context: RoundingRequestContext,
  facilityId: string,
) {
  return serviceRoleUserHasFacilityAccess(context.admin, {
    userId: context.userId,
    facilityId,
    organizationId: context.organizationId,
  });
}

/** Return only live facilities currently reachable by this actor. */
export async function getAccessibleRoundingFacilityIds(
  context: RoundingRequestContext,
): Promise<string[]> {
  const { data: facilities, error: facilityError } = await context.admin
    .from("facilities")
    .select("id")
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null);
  if (facilityError) {
    logError("rounding.auth", facilityError, { action: "resolve_accessible_facilities" });
    return [];
  }

  const facilityIds = (facilities ?? []).map((facility) => facility.id);
  if (context.appRole === "owner" || context.appRole === "org_admin") return facilityIds;
  if (facilityIds.length === 0) return [];

  const { data: grants, error: grantError } = await context.admin
    .from("user_facility_access")
    .select("facility_id")
    .eq("user_id", context.userId)
    .eq("organization_id", context.organizationId)
    .is("revoked_at", null)
    .in("facility_id", facilityIds);
  if (grantError) {
    logError("rounding.auth", grantError, { action: "resolve_facility_grants" });
    return [];
  }
  return (grants ?? []).map((grant) => grant.facility_id);
}
