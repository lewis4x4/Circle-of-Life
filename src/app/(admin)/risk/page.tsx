import RiskCommandPageClient from "@/components/risk/RiskCommandPageClient";
import { getServerSelectedFacilityId } from "@/lib/facilities/selected-facility-cookie.server";
import { loadRiskCommandData } from "@/lib/risk/load-risk-command";
import { loadRiskRoleContextServer } from "@/lib/risk/load-risk-context.server";
import { createClient } from "@/lib/supabase/server";

export default async function RiskCommandPage() {
  const roleContext = await loadRiskRoleContextServer();
  const selectedFacilityId = await getServerSelectedFacilityId();

  if (!roleContext.ok) {
    return (
      <RiskCommandPageClient
        initialData={null}
        initialError={roleContext.error}
        initialFacilityId={selectedFacilityId}
      />
    );
  }

  const supabase = await createClient();
  let initialData = null;
  let initialError: string | null = null;

  try {
    initialData = await loadRiskCommandData(
      supabase,
      roleContext.ctx.organizationId,
      selectedFacilityId,
    );
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load risk command.";
  }

  return (
    <RiskCommandPageClient
      initialData={initialData}
      initialError={initialError}
      initialFacilityId={selectedFacilityId}
    />
  );
}
