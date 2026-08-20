import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RoleHomePageGate, RoleHomeRouteLoading } from "@/components/auth/role-home-page-gate";
import { CoordinatorDashboardPageClient } from "@/components/coordinator/CoordinatorDashboardPageClient";
import { fetchCoordinatorDashboardBrief } from "@/lib/coordinator/dashboard-brief";
import {
  COORDINATOR_ROLE_HOME_AUDIENCE,
  getRoleDashboardConfig,
  ROLE_HOME_CHECKING_MESSAGE,
} from "@/lib/auth/dashboard-routing";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { createClient } from "@/lib/supabase/server";

const COORDINATOR_DASHBOARD_ROUTE = "/admin/coordinator-dashboard";

export default function CoordinatorDashboardPage() {
  return (
    <Suspense
      fallback={<RoleHomeRouteLoading message={`${ROLE_HOME_CHECKING_MESSAGE}…`} />}
    >
      <CoordinatorDashboardData />
    </Suspense>
  );
}

async function CoordinatorDashboardData() {
  const roleContext = await loadFinanceRoleContextServer();

  if (roleContext.ok) {
    const config = getRoleDashboardConfig(roleContext.ctx.appRole);
    if (config.route !== COORDINATOR_DASHBOARD_ROUTE) {
      redirect(config.route);
    }
  }

  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialBrief = null;
  let initialError: string | null = null;

  try {
    initialBrief = await fetchCoordinatorDashboardBrief(initialFacilityId, supabase);
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : "Unable to load coordinator dashboard.";
  }

  return (
    <RoleHomePageGate
      expectedRoute={COORDINATOR_DASHBOARD_ROUTE}
      homeAudienceLabel={COORDINATOR_ROLE_HOME_AUDIENCE}
    >
      <CoordinatorDashboardPageClient
        initialBrief={initialBrief}
        initialError={initialError}
        initialFacilityId={initialFacilityId}
      />
    </RoleHomePageGate>
  );
}
