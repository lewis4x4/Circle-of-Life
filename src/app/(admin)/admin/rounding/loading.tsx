import NamedAdminRouteLoading from "@/components/layout/named-admin-route-loading";
import { ADMIN_ROUNDING_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";

export default function AdminRoundingLoading() {
  return <NamedAdminRouteLoading message={ADMIN_ROUNDING_ROUTE_LOADING_MESSAGE} />;
}
