"use client";

import { usePathname } from "next/navigation";

import AdminRouteLoading from "@/components/layout/admin-route-loading";
import { RoleHomeRouteLoading } from "@/components/auth/role-home-page-gate";
import { isRoleHomePathname, ROLE_HOME_CHECKING_MESSAGE } from "@/lib/auth/dashboard-routing";

/**
 * Admin segment loading boundary: role-home dashboards get named checking copy;
 * other admin routes keep the shared skeleton.
 */
export default function AdminRoleRouteLoading() {
  const pathname = usePathname();

  if (isRoleHomePathname(pathname)) {
    return <RoleHomeRouteLoading message={`${ROLE_HOME_CHECKING_MESSAGE}…`} />;
  }

  return <AdminRouteLoading inset={false} />;
}
