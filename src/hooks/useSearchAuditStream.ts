"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchAuditEntry } from "@/lib/search-tools";

const PAGE_SIZE = 50;

/**
 * Real-time search audit log stream.
 * Subscribes to Supabase Realtime INSERTs on search_audit_log
 * and prepends new rows to the local state.
 */
export function useSearchAuditStream(organizationId: string | null) {
  // Cast to generic client until database.ts is regenerated with new tables
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const [entries, setEntries] = useState<SearchAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Load initial page
  const loadInitial = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("search_audit_log")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (err) {
      setError(err.message);
    } else {
      setEntries((data as SearchAuditEntry[]) ?? []);
    }
    setLoading(false);
  }, [supabase, organizationId]);

  // Subscribe to realtime inserts
  useEffect(() => {
    if (!organizationId) return;

    loadInitial();

    const channel = supabase
      .channel(`search-audit-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "search_audit_log",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const newEntry = payload.new as SearchAuditEntry;
          setEntries((prev) => [newEntry, ...prev].slice(0, PAGE_SIZE * 2));
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [supabase, organizationId, loadInitial]);

  // Stats derived from current entries
  const stats = useMemo(() => {
    const now = Date.now();
    const last5min = entries.filter(
      (e) => now - new Date(e.created_at).getTime() < 5 * 60 * 1000,
    );
    const last1hr = entries.filter(
      (e) => now - new Date(e.created_at).getTime() < 60 * 60 * 1000,
    );

    const toolCounts: Record<string, number> = {};
    const roleCounts: Record<string, number> = {};
    for (const e of entries) {
      toolCounts[e.tool_name] = (toolCounts[e.tool_name] ?? 0) + 1;
      roleCounts[e.app_role] = (roleCounts[e.app_role] ?? 0) + 1;
    }

    const avgDuration =
      entries.length > 0
        ? Math.round(
            entries.reduce((sum, e) => sum + (e.duration_ms ?? 0), 0) /
              entries.length,
          )
        : 0;

    return {
      totalLoaded: entries.length,
      last5min: last5min.length,
      last1hr: last1hr.length,
      toolCounts,
      roleCounts,
      avgDuration,
    };
  }, [entries]);

  return { entries, stats, loading, error, reload: loadInitial };
}
