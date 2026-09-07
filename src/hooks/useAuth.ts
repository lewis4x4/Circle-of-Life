/** Compatibility facade: legacy controls receive current, resolved authority. */
"use client";
import { useHavenAuth } from "@/contexts/haven-auth-context";

export function useAuth() {
  const { user, appRole, organizationId } = useHavenAuth();
  return {
    user: user && appRole && organizationId ? {
      ...user,
      app_metadata: { ...user.app_metadata, app_role: appRole, organization_id: organizationId },
    } : null,
  };
}
