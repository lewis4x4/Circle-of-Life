import { NextResponse } from "next/server";

import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { googleOAuthEnvReady } from "@/lib/reputation/google-oauth";
import { yelpFusionEnvReady } from "@/lib/reputation/yelp-fusion";
import { yelpPartnerPostEnvReady } from "@/lib/reputation/yelp-partner-reviews";

export async function GET() {
  const actorResult = await requireCurrentApiActor({ scope: "reputation.integrations.status" });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const { data: cred } = await actor.admin
    .from("reputation_google_oauth_credentials")
    .select("connected_at")
    .eq("organization_id", actor.organizationId)
    .maybeSingle();

  return NextResponse.json({
    googleOAuthEnvConfigured: googleOAuthEnvReady(),
    stateSecretConfigured: Boolean(process.env.REPUTATION_OAUTH_STATE_SECRET?.trim()?.length),
    yelpFusionConfigured: yelpFusionEnvReady(),
    /** Partner "respond to review" uses Bearer; falls back to Fusion key when YELP_PARTNER_API_KEY unset. */
    yelpPartnerPostConfigured: yelpPartnerPostEnvReady(),
    connected: Boolean(cred),
    connectedAt: cred?.connected_at ?? null,
    canManage: actor.appRole === "owner",
  });
}
