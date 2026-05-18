import { AdminResidentsPageClient } from "@/components/residents/AdminResidentsPageClient";
import { loadResidentsRosterBootstrap } from "@/lib/residents/residents-roster-bootstrap";

export default async function ClinicalResidentsPage() {
  const bootstrap = await loadResidentsRosterBootstrap();

  return (
    <AdminResidentsPageClient
      initialRows={bootstrap.initialRows}
      initialError={bootstrap.initialError}
      initialFacilityId={bootstrap.initialFacilityId}
      initialMetrics={bootstrap.initialMetrics}
      detailBaseHref="/clinical/residents"
    />
  );
}
