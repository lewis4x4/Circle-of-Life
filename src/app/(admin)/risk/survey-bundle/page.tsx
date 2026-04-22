import RiskSurveyBundlePageClient from "@/components/risk/RiskSurveyBundlePageClient";
import { getServerSelectedFacilityId } from "@/lib/facilities/selected-facility-cookie.server";
import { loadRiskRoleContextServer } from "@/lib/risk/load-risk-context.server";
import { loadSurveyBundlePacket } from "@/lib/risk/load-survey-bundle";
import { createClient } from "@/lib/supabase/server";

export default async function RiskSurveyBundlePage() {
  const roleContext = await loadRiskRoleContextServer();
  const selectedFacilityId = await getServerSelectedFacilityId();

  if (!roleContext.ok) {
    return (
      <RiskSurveyBundlePageClient
        initialPacket={null}
        initialError={roleContext.error}
        initialFacilityId={selectedFacilityId}
      />
    );
  }

  if (!selectedFacilityId) {
    return (
      <RiskSurveyBundlePageClient
        initialPacket={null}
        initialError={null}
        initialFacilityId={null}
      />
    );
  }

  const supabase = await createClient();
  let initialPacket = null;
  let initialError: string | null = null;

  try {
    initialPacket = await loadSurveyBundlePacket(
      supabase,
      roleContext.ctx.organizationId,
      selectedFacilityId,
    );
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load survey bundle.";
  }

  return (
    <RiskSurveyBundlePageClient
      initialPacket={initialPacket}
      initialError={initialError}
      initialFacilityId={selectedFacilityId}
    />
  );
}
