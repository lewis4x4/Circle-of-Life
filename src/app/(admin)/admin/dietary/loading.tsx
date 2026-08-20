import NamedAdminRouteLoading from "@/components/layout/named-admin-route-loading";
import { ADMIN_DIETARY_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";

export default function AdminDietaryLoading() {
  return <NamedAdminRouteLoading message={ADMIN_DIETARY_ROUTE_LOADING_MESSAGE} />;
}
