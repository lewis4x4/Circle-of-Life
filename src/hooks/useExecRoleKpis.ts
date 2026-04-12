"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchExecutiveKpiSnapshot,
  EXEC_KPI_METRICS_VERSION,
  type ExecKpiPayload,
} from "@/lib/exec-kpi-snapshot";
import { fetchExecutiveAlerts, type ExecutiveAlertRow } from "@/lib/exec-alerts";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { isDemoMode } from "@/lib/demo-mode";

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

/* ---------- demo fallback data ---------- */

const DEMO_KPI_PAYLOAD: ExecKpiPayload = {
  version: EXEC_KPI_METRICS_VERSION,
  census: { occupiedResidents: 42, licensedBeds: 52, occupancyPct: 80.8 },
  financial: { openInvoicesCount: 14, totalBalanceDueCents: 328_500 },
  clinical: { openIncidents: 3, medicationErrorsMtd: 1 },
  compliance: { openSurveyDeficiencies: 2 },
  workforce: { certificationsExpiring30d: 5 },
  infection: { activeOutbreaks: 0 },
};

const DEMO_FACILITIES: ExecRoleKpiData["facilities"] = [
  { id: "demo-f1", name: "Grande Cypress ALF", total_licensed_beds: 60 },
  { id: "demo-f2", name: "Homewood Lodge ALF", total_licensed_beds: 45 },
  { id: "demo-f3", name: "Oakridge ALF", total_licensed_beds: 52 },
  { id: "demo-f4", name: "Plantation ALF", total_licensed_beds: 48 },
  { id: "demo-f5", name: "Rising Oaks ALF", total_licensed_beds: 55 },
];

const DEMO_ALERTS: ExecutiveAlertRow[] = [];

/* ---------- hook ---------- */

/**
 * Auto-resolves organizationId from the user's profile, then fetches
 * executive KPIs, alerts, and facility list. Falls back to demo data
 * when NEXT_PUBLIC_DEMO_MODE=true and queries fail or return empty.
 */
export function useExecRoleKpis(facilityId?: string | null): ExecRoleKpiData {
  const [kpis, setKpis] = useState<ExecKpiPayload | null>(null);
  const [alerts, setAlerts] = useState<ExecutiveAlertRow[]>([]);
  const [facilities, setFacilities] = useState<ExecRoleKpiData["facilities"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

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
        if (isDemoMode()) {
          setKpis(DEMO_KPI_PAYLOAD);
          setAlerts(DEMO_ALERTS);
          setFacilities(DEMO_FACILITIES);
          setIsDemo(true);
          setLoading(false);
          return;
        }
        throw new Error(roleResult.error);
      }
      const { organizationId } = roleResult.ctx;

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
      // In demo mode, swallow errors and fall back to sample data.
      if (isDemoMode()) {
        setKpis(DEMO_KPI_PAYLOAD);
        setAlerts(DEMO_ALERTS);
        setFacilities(DEMO_FACILITIES);
        setIsDemo(true);
      } else {
        setKpis(null);
        setAlerts([]);
        setFacilities([]);
        setError(err instanceof Error ? err.message : "Failed to load executive KPIs.");
      }
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Realtime: auto-refetch when new snapshots or alerts arrive ──
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("exec-kpi-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "exec_metric_snapshots" }, () => {
        void load(); // Refetch when new KPI snapshot arrives
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "exec_alerts" }, () => {
        void load(); // Refetch when new alert arrives
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "exec_alerts" }, () => {
        void load(); // Refetch when alert is acknowledged/resolved
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [load]);

  return { kpis, alerts, facilities, loading, error, isDemo, refetch: load };
}
