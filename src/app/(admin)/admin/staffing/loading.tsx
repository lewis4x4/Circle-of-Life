import NamedAdminRouteLoading from "@/components/layout/named-admin-route-loading";
import { ADMIN_STAFFING_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";

export default function AdminStaffingLoading() {
  return <NamedAdminRouteLoading message={ADMIN_STAFFING_ROUTE_LOADING_MESSAGE} />;
}
