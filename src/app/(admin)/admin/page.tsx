import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminDashboardPageClient } from "@/components/admin/AdminDashboardPageClient";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import {
  fetchAdminDashboardSnapshot,
  type AdminDashboardSnapshot,
} from "@/lib/admin-dashboard-snapshot";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { createClient } from "@/lib/supabase/server";

export default async function AdminDashboardPage() {
  const roleContext = await loadFinanceRoleContextServer();

  if (!roleContext.ok) {
    return (
      <AdminDashboardPageClient
        initialSnapshot={null}
        initialError={roleContext.error}
        initialFacilityId={null}
      />
    );
  }

  const config = getRoleDashboardConfig(roleContext.ctx.appRole);
  if (config.route !== "/admin") {
    redirect(config.route);
  }

  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialSnapshot: AdminDashboardSnapshot | null = null;
  let initialError: string | null = null;

  try {
    initialSnapshot = await fetchAdminDashboardSnapshot(initialFacilityId, supabase);
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : "Unable to load triage metrics.";
  }

  return (
    <AdminDashboardPageClient
      initialSnapshot={initialSnapshot}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
    />
  );
}
