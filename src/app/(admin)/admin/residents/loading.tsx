import NamedAdminRouteLoading from "@/components/layout/named-admin-route-loading";
import { ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";

export default function AdminResidentsLoading() {
  return <NamedAdminRouteLoading message={ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE} />;
}
