import { NextResponse } from "next/server";

import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { runGoogleReviewSync } from "@/lib/reputation/run-google-review-sync";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

/**
 * Owner-only: fetch Google reviews for `reputation_accounts` with `platform = google_business`,
 * insert new rows into `reputation_replies` (draft + placeholder body). Idempotent on `external_review_id`.
 */
export async function POST(request: Request) {
  const actorResult = await requireCurrentApiActor({
    allowedRoles: ["owner"],
    scope: "reputation.sync.google",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  let facilityIdFilter: string | undefined;
  try {
    const j = (await request.json()) as { facilityId?: string };
    facilityIdFilter = typeof j.facilityId === "string" ? j.facilityId.trim() || undefined : undefined;
  } catch {
    facilityIdFilter = undefined;
  }

  if (facilityIdFilter) {
    const canAccessFacility = await serviceRoleUserHasFacilityAccess(actor.admin, {
      userId: actor.id,
      facilityId: facilityIdFilter,
      organizationId: actor.organizationId,
    });
    if (!canAccessFacility) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }
  }

  let currentActor = actor;
  const authorize = async (facilityId?: string) => {
    const currentResult = await revalidateCurrentApiActor(currentActor, {
      allowedRoles: ["owner"],
      scope: "reputation.sync.google.revalidate",
    });
    if ("response" in currentResult) return false;
    currentActor = currentResult.actor;
    if (currentActor.organizationId !== actor.organizationId) return false;
    if (!facilityId) return true;
    return serviceRoleUserHasFacilityAccess(currentActor.admin, {
      userId: currentActor.id,
      facilityId,
      organizationId: currentActor.organizationId,
    });
  };

  const result = await runGoogleReviewSync({
    organizationId: actor.organizationId,
    facilityId: facilityIdFilter,
    actorUserId: actor.id,
    supabase: actor.client,
    admin: actor.admin,
    authorize,
  });

  if (result.status === "no_credentials") {
    if (result.reason === "load_failed") {
      return NextResponse.json(
        { error: "Google connection status could not be verified. Retry the import." },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "Google is not connected for this organization. Connect under Integrations first." },
      { status: 400 },
    );
  }
  if (result.status === "token_refresh") {
    return NextResponse.json(
      { error: "Google authorization could not be refreshed. Reconnect Google and retry." },
      { status: 502 },
    );
  }
  if (result.status === "account_load") {
    return NextResponse.json(
      {
        error: result.authorizationLost
          ? "Your access changed. Sign in again before importing reviews."
          : "Google Business listings could not be loaded. Retry the import.",
      },
      { status: result.authorizationLost ? 403 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    imported: result.imported,
    accountsProcessed: result.accountsProcessed,
    details: result.details,
  });
}
