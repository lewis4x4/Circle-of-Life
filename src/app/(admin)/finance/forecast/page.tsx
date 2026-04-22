import FinanceForecastPageClient from "@/components/finance/FinanceForecastPageClient";
import { getServerSelectedFacilityId } from "@/lib/facilities/selected-facility-cookie.server";
import { loadFinanceForecastData } from "@/lib/finance/load-forecast-data";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { createClient } from "@/lib/supabase/server";

export default async function FinanceForecastPage() {
  const roleContext = await loadFinanceRoleContextServer();
  const selectedFacilityId = await getServerSelectedFacilityId();

  if (!roleContext.ok) {
    return (
      <FinanceForecastPageClient
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
    initialData = await loadFinanceForecastData(
      supabase,
      roleContext.ctx.organizationId,
      selectedFacilityId,
    );
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load finance forecast.";
  }

  return (
    <FinanceForecastPageClient
      initialData={initialData}
      initialError={initialError}
      initialFacilityId={selectedFacilityId}
    />
  );
}
