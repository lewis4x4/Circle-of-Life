"use client";

import { useHavenAuth } from "@/contexts/haven-auth-context";

/**
 * KB `workspace_id` is the signed-in user's organization id (see `documents.workspace_id` RLS).
 * Uses shared auth context to avoid a duplicate `user_profiles` fetch.
 */
export function useKbWorkspaceId() {
  const { organizationId, loading, session, refresh } = useHavenAuth();

  let error: string | null = null;
  if (!loading) {
    if (!session) {
      error = "Not signed in.";
    } else if (!organizationId) {
      error = "Your profile is missing an organization. Contact an administrator.";
    }
  }

  return {
    workspaceId: organizationId,
    loading,
    error,
    reload: refresh,
  };
}
