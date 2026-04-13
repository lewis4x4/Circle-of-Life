"use client";

/**
 * Realtime subscription for executive KPI updates.
 *
 * Subscribes to Supabase Realtime channels on:
 * - exec_metric_snapshots (INSERT) — new KPI snapshots
 * - exec_alerts (INSERT/UPDATE) — new or resolved alerts
 *
 * Returns callbacks that update parent state when new data arrives.
 */

import { useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

interface RealtimeCallbacks {
  /** Called when a new KPI snapshot is inserted */
  onSnapshotInsert?: (payload: Record<string, unknown>) => void;
  /** Called when a new alert is inserted */
  onAlertInsert?: (payload: Record<string, unknown>) => void;
  /** Called when an alert is updated (acknowledged, resolved) */
  onAlertUpdate?: (payload: Record<string, unknown>) => void;
}

/**
 * Subscribe to Realtime updates for executive KPIs and alerts.
 *
 * @param organizationId — org to scope the subscription to
 * @param callbacks — handlers for each event type
 */
export function useExecRealtimeKpis(
  organizationId: string | null,
  callbacks: RealtimeCallbacks,
) {
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Use ref for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!organizationId) return;

    // Clean up any existing subscription
    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`exec-kpi-${organizationId}`)
      // KPI snapshot inserts
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "exec_metric_snapshots",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          callbacksRef.current.onSnapshotInsert?.(payload.new as Record<string, unknown>);
        },
      )
      // Alert inserts
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "exec_alerts",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          callbacksRef.current.onAlertInsert?.(payload.new as Record<string, unknown>);
        },
      )
      // Alert updates (acknowledged, resolved)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "exec_alerts",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          callbacksRef.current.onAlertUpdate?.(payload.new as Record<string, unknown>);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [supabase, organizationId]);
}
