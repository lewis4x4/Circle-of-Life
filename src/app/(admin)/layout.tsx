import type { ReactNode } from "react";

import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function AdminRouteGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  // HavenAuthProvider is mounted once here, at the (admin) route-group root, so
  // every admin page — /admin/*, /insurance/*, /billing/*, /vendors/*,
  // /executive/*, etc. — shares a single identity context. It loads the session
  // + profile once and stays warm across navigations within the group, which is
  // what lets pages read {user, appRole, organizationId} from useHavenAuth()
  // instead of each re-running auth/profile context loaders on mount.
  return (
    <AppRuntimeProviders>
      <HavenAuthProvider>{children}</HavenAuthProvider>
    </AppRuntimeProviders>
  );
}
