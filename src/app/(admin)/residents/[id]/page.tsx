import { cookies } from "next/headers";

import { ResidentDetailOverviewClient } from "@/components/residents/ResidentDetailOverviewClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { loadResidentDetailBootstrap } from "@/lib/residents/resident-detail-bootstrap";

type AdminResidentDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminResidentDetailPage({ params }: AdminResidentDetailPageProps) {
  const [{ id }, cookieStore] = await Promise.all([params, cookies()]);
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );
  const bootstrap = await loadResidentDetailBootstrap(id, initialFacilityId);

  return (
    <ResidentDetailOverviewClient
      workspace="admin"
      initialDetail={bootstrap.initialDetail}
      initialError={bootstrap.initialError}
      initialFacilityId={bootstrap.initialFacilityId}
    />
  );
}
