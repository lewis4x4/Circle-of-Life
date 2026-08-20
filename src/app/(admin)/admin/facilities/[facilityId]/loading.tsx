import NamedAdminRouteLoading from "@/components/layout/named-admin-route-loading";
import { ADMIN_FACILITY_OVERVIEW_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";

export default function AdminFacilityOverviewLoading() {
  return <NamedAdminRouteLoading message={ADMIN_FACILITY_OVERVIEW_ROUTE_LOADING_MESSAGE} />;
}
