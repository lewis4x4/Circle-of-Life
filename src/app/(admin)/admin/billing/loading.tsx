import NamedAdminRouteLoading from "@/components/layout/named-admin-route-loading";
import { ADMIN_BILLING_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";

export default function AdminBillingLoading() {
  return <NamedAdminRouteLoading message={ADMIN_BILLING_ROUTE_LOADING_MESSAGE} />;
}
