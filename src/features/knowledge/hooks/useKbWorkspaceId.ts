"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * KB `workspace_id` is the signed-in user's organization id (see `documents.workspace_id` RLS).
 */
export function useKbWorkspaceId() {
  const supabase = useMemo(() => createClient(), []);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setWorkspaceId(null);
      setError("Not signed in.");
      setLoading(false);
      return;
    }
    const { data, error: profileError } = await supabase
      .from("user_profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) {
      setError(profileError.message);
      setWorkspaceId(null);
    } else if (!data?.organization_id) {
      setError("Your profile is missing an organization. Contact an administrator.");
      setWorkspaceId(null);
    } else {
      setWorkspaceId(data.organization_id);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return { workspaceId, loading, error, reload: load };
}
