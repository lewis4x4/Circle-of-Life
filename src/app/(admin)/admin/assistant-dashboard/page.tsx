import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AssistantDashboardPageClient } from "@/components/admin-assistant/AssistantDashboardPageClient";
import AdminRouteLoading from "@/components/layout/admin-route-loading";
import { fetchAdminAssistantDashboardBrief } from "@/lib/admin-assistant/dashboard-brief";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { createClient } from "@/lib/supabase/server";

export default function AssistantDashboardPage() {
  return (
    <Suspense fallback={<AdminRouteLoading inset={false} />}>
      <AssistantDashboardData />
    </Suspense>
  );
}

async function AssistantDashboardData() {
  const roleContext = await loadFinanceRoleContextServer();

  if (roleContext.ok) {
    const config = getRoleDashboardConfig(roleContext.ctx.appRole);
    if (config.route !== "/admin/assistant-dashboard") {
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
    <AssistantDashboardPageClient
      initialBrief={initialBrief}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
    />
  );
}
