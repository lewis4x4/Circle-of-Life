"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SEARCH_TOOLS,
  MATRIX_DISPLAY_ROLES,
  DEFAULT_TOOL_ACCESS,
  type SearchToolPolicy,
} from "@/lib/search-tools";

type PolicyMap = Record<string, Record<string, boolean>>;

/**
 * Loads search_tool_policies for the current org.
 * Returns a 2D map: policyMap[tool_name][app_role] = enabled.
 */
export function useSearchToolPolicies(organizationId: string | null) {
  // Cast to generic client until database.ts is regenerated with new tables
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const [policies, setPolicies] = useState<SearchToolPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("search_tool_policies")
      .select("*")
      .eq("organization_id", organizationId)
      .order("tool_name");

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setPolicies((data as SearchToolPolicy[]) ?? []);
    setLoading(false);
  }, [supabase, organizationId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  // Build the 2D lookup map from persisted policies only.
  const policyMap: PolicyMap = useMemo(() => {
    const map: PolicyMap = {};
    for (const tool of SEARCH_TOOLS) {
      map[tool.name] = {};
      for (const role of MATRIX_DISPLAY_ROLES) {
        const row = policies.find(
          (p) => p.tool_name === tool.name && p.app_role === role,
        );
        map[tool.name][role] = row?.enabled ?? false;
      }
    }
    return map;
  }, [policies]);

  // Toggle a single tool×role policy
  const togglePolicy = useCallback(
    async (toolName: string, appRole: string) => {
      if (!organizationId) return;
      setSaving(true);

      const currentValue = policyMap[toolName]?.[appRole] ?? false;
      const newValue = !currentValue;
      const tool = SEARCH_TOOLS.find((t) => t.name === toolName);
      if (!tool) return;

      // Optimistic update
      setPolicies((prev) => {
        const existing = prev.find(
          (p) => p.tool_name === toolName && p.app_role === appRole,
        );
        if (existing) {
          return prev.map((p) =>
            p.id === existing.id ? { ...p, enabled: newValue } : p,
          );
        }
        // Create a local placeholder
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            organization_id: organizationId,
            tool_name: toolName,
            tool_tier: tool.tier,
            app_role: appRole,
            enabled: newValue,
            updated_by: null,
            updated_at: new Date().toISOString(),
          },
        ];
      });

      // Upsert to DB
      const { error: err } = await supabase.from("search_tool_policies").upsert(
        {
          organization_id: organizationId,
          tool_name: toolName,
          tool_tier: tool.tier,
          app_role: appRole,
          enabled: newValue,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,tool_name,app_role" },
      );

      if (err) {
        setError(err.message);
        // Revert optimistic update
        await load();
      }
      setSaving(false);
    },
    [supabase, organizationId, policyMap, load],
  );

  // Seed all defaults for this org (first-time setup)
  const seedDefaults = useCallback(async () => {
    if (!organizationId) return;
    setSaving(true);

    const rows: Array<{
      organization_id: string;
      tool_name: string;
      tool_tier: string;
      app_role: string;
      enabled: boolean;
    }> = [];

    for (const tool of SEARCH_TOOLS) {
      for (const role of MATRIX_DISPLAY_ROLES) {
        rows.push({
          organization_id: organizationId,
          tool_name: tool.name,
          tool_tier: tool.tier,
          app_role: role,
          enabled: DEFAULT_TOOL_ACCESS[tool.name]?.has(role) ?? false,
        });
      }
    }

    const { error: err } = await supabase
      .from("search_tool_policies")
      .upsert(rows, { onConflict: "organization_id,tool_name,app_role" });

    if (err) {
      setError(err.message);
    } else {
      await load();
    }
    setSaving(false);
  }, [supabase, organizationId, load]);

  return { policyMap, policies, loading, saving, error, togglePolicy, seedDefaults, reload: load };
}
