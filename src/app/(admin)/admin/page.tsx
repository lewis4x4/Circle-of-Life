import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AdminRouteLoading from "@/components/layout/admin-route-loading";
import { isFacilityOperatorRole } from "@/lib/auth/app-role";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { getServerAuthContext } from "@/lib/auth/server-context";
import {
  fetchAdminDashboardSnapshot,
  type AdminDashboardSnapshot,
} from "@/lib/admin-dashboard-snapshot";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { loadHome } from "@/lib/home/load-home";
import { resolveOperatorHomeFacility } from "@/lib/home/resolve-facility";
import { createClient } from "@/lib/supabase/server";
import { AdminDashboardPageClient, FacilityOperatorHomePageClient } from "@/components/admin/AdminHomeViews";

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<AdminRouteLoading inset={false} />}>
      <CommandCenterData />
    </Suspense>
  );
}

async function CommandCenterData() {
  const auth = await getServerAuthContext();

  if (!auth.ok) {
    return (
      <AdminDashboardPageClient
        initialSnapshot={null}
        initialError={auth.error}
        initialFacilityId={null}
      />
    );
  }

  const config = getRoleDashboardConfig(auth.ctx.appRole);
  if (config.route !== "/admin") {
    redirect(config.route);
  }

  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();

  // COL-593: Administrator, Assistant Administrator and Manager land on the
  // facility-scoped Home. Owners and org admins keep the Command Center path.
  if (isFacilityOperatorRole(auth.ctx.appRole)) {
    const facilityId = await resolveOperatorHomeFacility(supabase, auth.ctx.userId, initialFacilityId);
    if (facilityId) {
      const initial = await loadHome(supabase, { facilityId, organizationId: auth.ctx.organizationId });
      return (
        <FacilityOperatorHomePageClient
          key={facilityId}
          initial={initial}
          initialFacilityId={facilityId}
          currentUserId={auth.ctx.userId}
          fullName={auth.ctx.fullName}
          appRole={auth.ctx.appRole}
        />
      );
    }
  }

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
