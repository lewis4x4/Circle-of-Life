import { RoleHomeRouteLoading } from "@/components/auth/role-home-page-gate";
import { ROLE_HOME_CHECKING_MESSAGE } from "@/lib/auth/dashboard-routing";

export default function CoordinatorDashboardLoading() {
  return <RoleHomeRouteLoading message={`${ROLE_HOME_CHECKING_MESSAGE}…`} />;
}
