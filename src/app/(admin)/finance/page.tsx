import FinanceOverviewPageClient from "@/components/finance/FinanceOverviewPageClient";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { loadFinanceOverviewData } from "@/lib/finance/load-finance-overview-data";
import { createClient } from "@/lib/supabase/server";

export default async function AdminFinanceHubPage() {
  const roleContext = await loadFinanceRoleContextServer();
  const roleLabel = roleContext.ok
    ? getRoleDashboardConfig(roleContext.ctx.appRole).roleLabel
    : "Finance";

  if (!roleContext.ok) {
    return (
      <FinanceOverviewPageClient
        roleLabel={roleLabel}
        postedCount={null}
        unpostedInvoices={null}
        initialError={roleContext.error}
      />
    );
  }

  const supabase = await createClient();
  let postedCount: number | null = null;
  let unpostedInvoices: number | null = null;
  let initialError: string | null = null;

  try {
    const snapshot = await loadFinanceOverviewData(supabase, roleContext.ctx.organizationId);
    postedCount = snapshot.postedCount;
    unpostedInvoices = snapshot.unpostedInvoices;
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load finance overview.";
  }

  return (
    <FinanceOverviewPageClient
      roleLabel={roleLabel}
      postedCount={postedCount}
      unpostedInvoices={unpostedInvoices}
      initialError={initialError}
    />
  );
}
