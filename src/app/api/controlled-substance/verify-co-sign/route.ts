import { NextResponse } from "next/server";
import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";
import {
  checkFailureRateLimit,
  clearFailureRateLimit,
  recordFailureRateLimit,
} from "@/lib/security/in-memory-failure-rate-limit";
import { verifyWitnessCredentials } from "@/lib/supabase/witness-auth";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

type Body = {
  /** Single row (legacy) */
  countId?: string;
  /** Batch: all must be same facility, same outgoing, incoming null */
  countIds?: string[];
  email?: string;
  password?: string;
  facilityId?: string;
};

const ALLOWED_ROLES = new Set(["nurse", "caregiver"]);
const OUTGOING_ROLES = ["nurse", "caregiver", "med_tech"] as const;
const FAILURE_LIMIT = {
  maxFailures: 5,
  windowMs: 10 * 60 * 1000,
} as const;

function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

/**
 * Verifies incoming staff credentials without creating a browser session.
 * Updates controlled_substance_counts when verification succeeds.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ verified: false, error: "Invalid JSON" }, { status: 400 });
  }

  const singleId = body.countId?.trim();
  const batchIds = Array.isArray(body.countIds)
    ? body.countIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const countIds = singleId ? [singleId] : batchIds;

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const facilityId = body.facilityId?.trim();

  if (countIds.length === 0 || !email || !password || !facilityId) {
    return NextResponse.json(
      { verified: false, error: "countId or countIds, email, password, and facilityId are required" },
      { status: 400 },
    );
  }

  const actorResult = await requireCurrentApiActor({
    allowedRoles: OUTGOING_ROLES,
    scope: "controlled-substance.verify-co-sign",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const okOutgoingFac = await serviceRoleUserHasFacilityAccess(admin, {
    userId: actor.id,
    facilityId,
    organizationId: actor.organizationId,
  });

  if (!okOutgoingFac) {
    return NextResponse.json(
      { verified: false, error: "Your session does not have access to this facility" },
      { status: 403 },
    );
  }

  const { data: rows, error: rowErr } = await admin
    .from("controlled_substance_counts")
    .select("id, facility_id, organization_id, outgoing_staff_id, incoming_staff_id")
    .in("id", countIds)
    .eq("organization_id", actor.organizationId)
    .eq("facility_id", facilityId)
    .eq("outgoing_staff_id", actor.id)
    .is("deleted_at", null);

  if (rowErr || !rows?.length || rows.length !== countIds.length) {
    return NextResponse.json({ verified: false, error: "Count record(s) not found" }, { status: 404 });
  }

  const limiterKey = [
    getRequestIp(request),
    actor.id,
    facilityId,
    email,
  ].join(":");
  const rateLimit = checkFailureRateLimit(limiterKey, FAILURE_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { verified: false, error: "Too many failed verification attempts" },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  const providerActorResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: OUTGOING_ROLES,
    scope: "controlled-substance.verify-co-sign.provider-revalidate",
  });
  if ("response" in providerActorResult) return providerActorResult.response;
  const providerActor = providerActorResult.actor;
  if (providerActor.organizationId !== actor.organizationId) {
    return NextResponse.json({ verified: false, error: "Count record(s) not found" }, { status: 404 });
  }
  const stillHasOutgoingFacilityAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: providerActor.id,
    facilityId,
    organizationId: providerActor.organizationId,
  });
  if (!stillHasOutgoingFacilityAccess) {
    return NextResponse.json(
      { verified: false, error: "Your session does not have access to this facility" },
      { status: 403 },
    );
  }

  let verification;
  try {
    verification = await verifyWitnessCredentials(email, password);
  } catch (error) {
    logError("controlled-substance.verify-co-sign", error, { action: "witness_authentication" });
    return NextResponse.json({ verified: false, error: "Witness verification unavailable" }, { status: 503 });
  }
  const { data: authData, error: authErr } = verification;

  if (authErr || !authData?.user) {
    recordFailureRateLimit(limiterKey, FAILURE_LIMIT);
    return NextResponse.json({ verified: false, error: "Invalid credentials" }, { status: 401 });
  }

  clearFailureRateLimit(limiterKey);

  const incomingId = authData.user.id;

  if (incomingId === actor.id) {
    return NextResponse.json(
      { verified: false, error: "Incoming staff must be a different person than outgoing" },
      { status: 400 },
    );
  }

  const { data: profile, error: profErr } = await admin
    .from("user_profiles")
    .select("app_role, full_name, organization_id")
    .eq("id", incomingId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (profErr || !profile) {
    return NextResponse.json({ verified: false, error: "Profile not found" }, { status: 403 });
  }

  if (!profile.organization_id) {
    return NextResponse.json(
      { verified: false, error: "Incoming profile missing organization" },
      { status: 403 },
    );
  }

  if (!ALLOWED_ROLES.has(profile.app_role)) {
    return NextResponse.json(
      { verified: false, error: "Only nurse or caregiver may co-sign" },
      { status: 403 },
    );
  }

  const okIncomingFac = await serviceRoleUserHasFacilityAccess(admin, {
    userId: incomingId,
    facilityId,
    organizationId: profile.organization_id,
  });

  if (!okIncomingFac) {
    return NextResponse.json(
      { verified: false, error: "Staff does not have access to this facility" },
      { status: 403 },
    );
  }

  const orgId = rows[0].organization_id;

  for (const row of rows) {
    if (profile.organization_id !== row.organization_id) {
      return NextResponse.json(
        { verified: false, error: "Incoming staff organization does not match this count" },
        { status: 403 },
      );
    }
    if (row.incoming_staff_id != null) {
      return NextResponse.json(
        { verified: false, error: "One or more counts already have an incoming signature" },
        { status: 409 },
      );
    }
  }

  const mutationActorResult = await revalidateCurrentApiActor(providerActor, {
    allowedRoles: OUTGOING_ROLES,
    scope: "controlled-substance.verify-co-sign.mutation-revalidate",
  });
  if ("response" in mutationActorResult) return mutationActorResult.response;
  const mutationActor = mutationActorResult.actor;
  if (mutationActor.organizationId !== orgId) {
    return NextResponse.json({ verified: false, error: "Count record(s) not found" }, { status: 404 });
  }
  const canStillMutateFacility = await serviceRoleUserHasFacilityAccess(admin, {
    userId: mutationActor.id,
    facilityId,
    organizationId: mutationActor.organizationId,
  });
  if (!canStillMutateFacility) {
    return NextResponse.json(
      { verified: false, error: "Your session does not have access to this facility" },
      { status: 403 },
    );
  }

  const { error: upErr } = await admin.rpc("complete_verified_controlled_counts", {
    p_count_ids: countIds,
    p_outgoing_id: mutationActor.id,
    p_incoming_id: incomingId,
    p_facility_id: facilityId,
    p_organization_id: orgId,
  });
  if (upErr) {
    logError("controlled-substance.verify-co-sign", upErr, { action: "update_counts", countCount: countIds.length, facilityId });
    return NextResponse.json({ verified: false, error: "Counts changed or signature could not be saved. Refresh and retry." }, { status: 409 });
  }

  const displayName =
    profile.full_name?.trim() ||
    authData.user.email ||
    email;

  return NextResponse.json({
    verified: true,
    user_id: incomingId,
    display_name: displayName,
  });
}
