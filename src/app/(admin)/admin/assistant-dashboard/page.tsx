import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RoleHomePageGate, RoleHomeRouteLoading } from "@/components/auth/role-home-page-gate";
import { AssistantDashboardPageClient } from "@/components/admin-assistant/AssistantDashboardPageClient";
import { fetchAdminAssistantDashboardBrief } from "@/lib/admin-assistant/dashboard-brief";
import {
  ADMIN_ASSISTANT_ROLE_HOME_AUDIENCE,
  getRoleDashboardConfig,
  ROLE_HOME_CHECKING_MESSAGE,
} from "@/lib/auth/dashboard-routing";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { createClient } from "@/lib/supabase/server";

const ASSISTANT_DASHBOARD_ROUTE = "/admin/assistant-dashboard";

export default function AssistantDashboardPage() {
  return (
    <Suspense
      fallback={<RoleHomeRouteLoading message={`${ROLE_HOME_CHECKING_MESSAGE}…`} />}
    >
      <AssistantDashboardData />
    </Suspense>
  );
}

async function AssistantDashboardData() {
  const roleContext = await loadFinanceRoleContextServer();

  if (roleContext.ok) {
    const config = getRoleDashboardConfig(roleContext.ctx.appRole);
    if (config.route !== ASSISTANT_DASHBOARD_ROUTE) {
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
    initialBrief = await fetchAdminAssistantDashboardBrief(initialFacilityId, supabase);
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : "Unable to load assistant dashboard.";
  }

  return (
    <RoleHomePageGate
      expectedRoute={ASSISTANT_DASHBOARD_ROUTE}
      homeAudienceLabel={ADMIN_ASSISTANT_ROLE_HOME_AUDIENCE}
    >
      <AssistantDashboardPageClient
        initialBrief={initialBrief}
        initialError={initialError}
        initialFacilityId={initialFacilityId}
      />
    </RoleHomePageGate>
  );
}
