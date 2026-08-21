import { Suspense } from "react";

import NamedAdminRouteLoading from "@/components/layout/named-admin-route-loading";
import { AdminResidentsPageClient } from "@/components/residents/AdminResidentsPageClient";
import { ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";
import { loadResidentsRosterBootstrap } from "@/lib/residents/residents-roster-bootstrap";

export default function AdminResidentsPage() {
  return (
    <Suspense fallback={<NamedAdminRouteLoading message={ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE} />}>
      <ResidentsRosterData />
    </Suspense>
  );
}

async function ResidentsRosterData() {
  const bootstrap = await loadResidentsRosterBootstrap();

  return (
    <AdminResidentsPageClient
      initialRows={bootstrap.initialRows}
      initialError={bootstrap.initialError}
      initialFacilityId={bootstrap.initialFacilityId}
      initialMetrics={bootstrap.initialMetrics}
      detailBaseHref="/admin/residents"
    />
  );
}
