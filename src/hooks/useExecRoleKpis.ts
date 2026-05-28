"use client";

import { useState, useEffect, useCallback, useId, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchExecutiveKpiSnapshot,
  type ExecKpiPayload,
} from "@/lib/exec-kpi-snapshot";
import { fetchExecutiveAlerts, type ExecutiveAlertRow } from "@/lib/exec-alerts";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { createReloadDebouncer } from "@/hooks/exec-metric-reload-debounce";

export type ExecRole = "ceo" | "cfo" | "coo";

export interface ExecRoleKpiData {
  kpis: ExecKpiPayload | null;
  alerts: ExecutiveAlertRow[];
  facilities: Array<{ id: string; name: string; total_licensed_beds: number | null }>;
  loading: boolean;
  error: string | null;
  isDemo: boolean;
  refetch: () => void;
}

/**
 * Auto-resolves organizationId from the user's profile, then fetches
 * executive KPIs, alerts, and facility list.
 *
 * Pass `enabled=false` to defer all network work (queries + realtime
 * subscription) until the caller actually needs the data. Used by
 * HavenInsightProvider so the exec-KPI fetch does not fire on every
 * admin page load for a panel that may never be opened.
 */
export function useExecRoleKpis(
  facilityId?: string | null,
  enabled: boolean = true,
): ExecRoleKpiData {
  const [kpis, setKpis] = useState<ExecKpiPayload | null>(null);
  const [alerts, setAlerts] = useState<ExecutiveAlertRow[]>([]);
  const [facilities, setFacilities] = useState<ExecRoleKpiData["facilities"]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const realtimeChannelKey = `exec-kpi-realtime-${useId().replace(/:/g, "")}`;
  const metricInsertReloadDebouncerRef = useRef<ReturnType<typeof createReloadDebouncer> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setIsDemo(false);

    const supabase = createClient();
    const facId = facilityId ?? null;

    try {
      // Resolve organizationId from user profile (same pattern as finance pages)
      const roleResult = await loadFinanceRoleContext(supabase);
      if (!roleResult.ok) {
        setOrganizationId(null);
        throw new Error(roleResult.error);
      }
      const { organizationId } = roleResult.ctx;
      setOrganizationId(organizationId);

      const [kpiResult, alertsResult, facilitiesResult] = await Promise.all([
        fetchExecutiveKpiSnapshot(supabase, organizationId, facId),
        fetchExecutiveAlerts(supabase, organizationId, facId, 10),
        supabase
          .from("facilities")
          .select("id, name, total_licensed_beds")
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .order("name", { ascending: true }),
      ]);

      setKpis(kpiResult);
      setAlerts(alertsResult);

      if (facilitiesResult.error) {
        throw new Error(facilitiesResult.error.message);
      }
      setFacilities(facilitiesResult.data ?? []);
    } catch (err) {
      setOrganizationId(null);
      setKpis(null);
      setAlerts([]);
      setFacilities([]);
      setError(err instanceof Error ? err.message : "Failed to load executive KPIs.");
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  // ── Realtime: auto-refetch when new snapshots or alerts arrive ──
  useEffect(() => {
    metricInsertReloadDebouncerRef.current?.cancel();
    metricInsertReloadDebouncerRef.current = createReloadDebouncer(() => {
      void load();
    }, 200);

    if (!enabled || !organizationId || isDemo) {
      return;
    }

    const metricInsertReloadDebouncer = metricInsertReloadDebouncerRef.current;
    if (!metricInsertReloadDebouncer) {
      return;
    }
    const supabase = createClient();
    const channel = supabase
      .channel(realtimeChannelKey)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "exec_metric_snapshots", filter: `organization_id=eq.${organizationId}` }, () => {
        metricInsertReloadDebouncer.trigger();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "exec_alerts", filter: `organization_id=eq.${organizationId}` }, () => {
        void load(); // Refetch when new alert arrives
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "exec_alerts", filter: `organization_id=eq.${organizationId}` }, () => {
        void load(); // Refetch when alert is acknowledged/resolved
      })
      .subscribe();

    return () => {
      metricInsertReloadDebouncer.cancel();
      // unsubscribe returns a Promise that may reject with "Connection closed."
      // if the WebSocket already closed (e.g., during signOut → /login navigation).
      // Catch it so it doesn't surface as an unhandled rejection in Sentry.
      channel.unsubscribe().catch(() => {});
    };
  }, [enabled, isDemo, load, organizationId, realtimeChannelKey]);

  return { kpis, alerts, facilities, loading, error, isDemo, refetch: load };
}
