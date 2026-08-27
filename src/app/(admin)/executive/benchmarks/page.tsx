import ExecutiveBenchmarkCohortsPageClient from "@/components/executive/ExecutiveBenchmarksPageClient";
import { loadExecutiveBenchmarkData } from "@/lib/executive/load-benchmark-data";
import { canMutateFinance } from "@/lib/finance/load-finance-context";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/server";

export default async function ExecutiveBenchmarkCohortsPage() {
  const roleContext = await loadFinanceRoleContextServer();
  if (!roleContext.ok) {
    return (
      <ExecutiveBenchmarkCohortsPageClient
        initialData={null}
        initialError={roleContext.error}
        initialOrgId={null}
        initialCanManage={false}
      />
    );
  }

  const supabase = await createClient();
  let initialData = null;
  let initialError: string | null = null;

  try {
    initialData = await loadExecutiveBenchmarkData(supabase, roleContext.ctx.organizationId);
  } catch (error) {
    initialError = formatLiveDataLoadError(error, "Unable to load benchmark cohorts.");
  }

  return (
    <ExecutiveBenchmarkCohortsPageClient
      initialData={initialData}
      initialError={initialError}
      initialOrgId={roleContext.ctx.organizationId}
      initialCanManage={canMutateFinance(roleContext.ctx.appRole)}
    />
  );
}
