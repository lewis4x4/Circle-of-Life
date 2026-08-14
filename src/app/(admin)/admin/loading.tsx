import AdminRouteLoading from "@/components/layout/admin-route-loading";

/**
 * This boundary must live inside the shared `/admin` layout. A boundary at
 * `(admin)/loading.tsx` is above that layout and cannot render during sibling
 * navigations such as `/admin/residents` → `/admin/staff`.
 */
export default function AdminLoading() {
  return <AdminRouteLoading inset={false} />;
}
