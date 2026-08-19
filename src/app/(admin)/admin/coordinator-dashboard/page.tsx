import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CoordinatorDashboardPageClient } from "@/components/coordinator/CoordinatorDashboardPageClient";
import AdminRouteLoading from "@/components/layout/admin-route-loading";
import { fetchCoordinatorDashboardBrief } from "@/lib/coordinator/dashboard-brief";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { createClient } from "@/lib/supabase/server";

export default function CoordinatorDashboardPage() {
  return (
    <Suspense fallback={<AdminRouteLoading inset={false} />}>
      <CoordinatorDashboardData />
    </Suspense>
  );
}

async function CoordinatorDashboardData() {
  const roleContext = await loadFinanceRoleContextServer();

  if (roleContext.ok) {
    const config = getRoleDashboardConfig(roleContext.ctx.appRole);
    if (config.route !== "/admin/coordinator-dashboard") {
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
    <CoordinatorDashboardPageClient
      initialBrief={initialBrief}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
    />
  );
}
