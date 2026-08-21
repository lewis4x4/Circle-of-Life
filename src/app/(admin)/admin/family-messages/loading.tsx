import NamedAdminRouteLoading from "@/components/layout/named-admin-route-loading";
import { ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";

export default function FamilyMessagesLoading() {
  return <NamedAdminRouteLoading message={ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE} />;
}
