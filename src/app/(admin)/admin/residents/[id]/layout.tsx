import { cookies } from "next/headers";

import { AdminResidentDetailShell } from "@/components/residents/AdminResidentDetailShell";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { loadResidentDetailBootstrap } from "@/lib/residents/resident-detail-bootstrap";

type AdminResidentDetailLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export default async function AdminResidentDetailLayout({
  children,
  params,
}: AdminResidentDetailLayoutProps) {
  const { id } = await params;
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );
  const bootstrap = await loadResidentDetailBootstrap(id, initialFacilityId);

  return (
    <AdminResidentDetailShell
      initialDetail={bootstrap.initialDetail}
      initialError={bootstrap.initialError}
      initialFacilityId={bootstrap.initialFacilityId}
    >
      {children}
    </AdminResidentDetailShell>
  );
}
