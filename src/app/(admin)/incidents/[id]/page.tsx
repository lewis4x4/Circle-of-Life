import { cookies } from "next/headers";

import { AdminIncidentDetailPageClient } from "@/components/incidents/AdminIncidentDetailPageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { loadIncidentDetailBootstrap } from "@/lib/incidents/incident-detail-bootstrap";

type AdminIncidentDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminIncidentDetailPage({ params }: AdminIncidentDetailPageProps) {
  const [{ id }, cookieStore] = await Promise.all([params, cookies()]);
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );
  const bootstrap = await loadIncidentDetailBootstrap(id, initialFacilityId);

  return (
    <AdminIncidentDetailPageClient
      initialDetail={bootstrap.initialDetail}
      initialError={bootstrap.initialError}
      initialFacilityId={bootstrap.initialFacilityId}
    />
  );
}
