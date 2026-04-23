import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchExecutiveAlerts } from "@/lib/exec-alerts";
import { loadExecutiveKpiBulk } from "@/lib/executive/load-executive-kpi-bulk";
import type { Database } from "@/types/database";
import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";

export type CeoAlertDisplay = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  facility: string;
  age: string;
};

export type CeoDashboardData = {
  kpis: ExecKpiPayload | null;
  alerts: CeoAlertDisplay[];
};

function normalizeSeverity(
  severity: string | null | undefined,
): CeoAlertDisplay["severity"] {
  if (severity === "critical" || severity === "warning" || severity === "info") {
    return severity;
  }
  return "info";
}

function timeSince(iso: string | null): string {
  if (!iso) return "recent";
  const ms = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export async function loadCeoDashboardData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<CeoDashboardData> {
  const [{ orgKpi }, alerts, facilitiesRes] = await Promise.all([
    loadExecutiveKpiBulk(supabase, organizationId),
    fetchExecutiveAlerts(supabase, organizationId, null, 10),
    supabase
      .from("facilities")
      .select("id, name")
      .eq("organization_id", organizationId)
      .is("deleted_at", null),
  ]);

  if (facilitiesRes.error) {
    throw new Error(facilitiesRes.error.message);
  }

  const facilityNameMap = new Map(
    (facilitiesRes.data ?? []).map((row) => [row.id, row.name]),
  );

  return {
    kpis: orgKpi,
    alerts: alerts.map((alert) => ({
      id: alert.id,
      severity: normalizeSeverity(alert.severity),
      title: alert.title,
      description: alert.body ?? "",
      facility: alert.facility_id ? facilityNameMap.get(alert.facility_id) ?? alert.facility_id : "Enterprise",
      age: timeSince(alert.first_triggered_at),
    })),
  };
}
