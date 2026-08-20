import { RoleHomeRouteLoading } from "@/components/auth/role-home-page-gate";

type NamedAdminRouteLoadingProps = {
  message: string;
};

/** Shared named first-paint gap for flagship admin routes — matches RoleHomeRouteLoading tone. */
export function NamedAdminRouteLoading({ message }: NamedAdminRouteLoadingProps) {
  return <RoleHomeRouteLoading message={message} />;
}

export default NamedAdminRouteLoading;
