import { Suspense } from "react";

import AdminRouteLoading from "@/components/layout/admin-route-loading";
import { AdminResidentsPageClient } from "@/components/residents/AdminResidentsPageClient";
import { loadResidentsRosterBootstrap } from "@/lib/residents/residents-roster-bootstrap";

export default function AdminResidentsPage() {
  return (
    <Suspense fallback={<AdminRouteLoading inset={false} />}>
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
