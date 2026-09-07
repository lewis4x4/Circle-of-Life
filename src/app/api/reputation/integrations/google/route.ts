import { NextResponse } from "next/server";

import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";

/**
 * Disconnect Google OAuth credentials (owner-only).
 */
export async function DELETE() {
  const actorResult = await requireCurrentApiActor({
    allowedRoles: ["owner"],
    scope: "reputation.integrations.google.disconnect",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const currentResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: ["owner"],
    scope: "reputation.integrations.google.disconnect.revalidate",
  });
  if ("response" in currentResult) return currentResult.response;
  const currentActor = currentResult.actor;

  const { error: delErr } = await currentActor.admin
    .from("reputation_google_oauth_credentials")
    .delete()
    .eq("organization_id", currentActor.organizationId);

  if (delErr) {
    logError("reputation.integrations.google.disconnect", delErr);
    return NextResponse.json({ error: "Could not disconnect Google" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
