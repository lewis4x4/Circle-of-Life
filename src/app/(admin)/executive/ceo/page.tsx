import CeoDashboardPageClient from "@/components/executive/CeoDashboardPageClient";
import type { CeoAlertDisplay } from "@/lib/executive/load-ceo-dashboard-data";
import { loadCeoDashboardData } from "@/lib/executive/load-ceo-dashboard-data";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import { createClient } from "@/lib/supabase/server";

export default async function CeoDashboardPage() {
  const roleContext = await loadFinanceRoleContextServer();

  if (!roleContext.ok) {
    return (
      <CeoDashboardPageClient
        initialKpis={null}
        initialAlerts={[]}
        initialError={roleContext.error}
      />
    );
  }

  const supabase = await createClient();
  let initialKpis: ExecKpiPayload | null = null;
  let initialAlerts: CeoAlertDisplay[] = [];
  let initialError: string | null = null;

  try {
    const data = await loadCeoDashboardData(
      supabase,
      roleContext.ctx.organizationId,
    );
    initialKpis = data.kpis;
    initialAlerts = data.alerts;
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : "Failed to load CEO dashboard.";
  }

  return (
    <CeoDashboardPageClient
      initialKpis={initialKpis}
      initialAlerts={initialAlerts}
      initialError={initialError}
    />
  );
}
