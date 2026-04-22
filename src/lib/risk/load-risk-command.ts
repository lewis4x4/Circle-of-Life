import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import type { ExecutiveAlertRow } from "@/lib/exec-alerts";

export type RiskDriver = {
  key: string;
  label: string;
  count: number;
  penalty: number;
  detail: string;
};

export type RiskSnapshotRow = {
  id: string;
  facility_id: string;
  snapshot_date: string;
  computed_at: string;
  risk_score: number;
  risk_level: "low" | "moderate" | "high" | "critical";
  score_delta: number | null;
  component_scores_json: Record<string, unknown>;
  summary_json: {
    top_drivers?: RiskDriver[];
    overdue_task_count?: number;
    license_threatening_count?: number;
    staffing_non_compliant_count?: number;
    open_survey_deficiency_count?: number;
    open_incident_count?: number;
    resident_safety_critical_count?: number;
    resident_safety_high_count?: number;
  } | null;
  alert_threshold_breached: boolean;
  owner_alert_triggered_at: string | null;
};

export type RiskDeliveryRow = {
  id: string;
  facility_id: string | null;
  recipient_role: string;
  recipient_phone: string | null;
  channel: "sms" | "push" | "in_app";
  delivery_status: "sent" | "failed" | "skipped";
  error_message: string | null;
  sent_at: string;
};

export type RiskFacilityMini = {
  id: string;
  name: string;
};

export type RiskPageSnapshot = {
  facilities: RiskFacilityMini[];
  latestRows: Array<RiskSnapshotRow & { facilityName: string; topDrivers: RiskDriver[] }>;
  historyRows: RiskSnapshotRow[];
  recentDeliveries: Array<RiskDeliveryRow & { facilityName: string }>;
  openAlerts: ExecutiveAlertRow[];
  smsSent24h: number;
};

export async function loadRiskCommandData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  facilityId: string | null,
): Promise<RiskPageSnapshot> {
  let facilityQuery = supabase
    .from("facilities")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("name");

  let snapshotQuery = supabase
    .from("risk_score_snapshots" as never)
    .select(
      "id, facility_id, snapshot_date, computed_at, risk_score, risk_level, score_delta, component_scores_json, summary_json, alert_threshold_breached, owner_alert_triggered_at",
    )
    .eq("organization_id" as never, organizationId as never)
    .is("deleted_at" as never, null as never)
    .order("snapshot_date" as never, { ascending: false })
    .order("computed_at" as never, { ascending: false })
    .limit(120);

  let deliveryQuery = supabase
    .from("risk_owner_alert_deliveries" as never)
    .select("id, facility_id, recipient_role, recipient_phone, channel, delivery_status, error_message, sent_at")
    .eq("organization_id" as never, organizationId as never)
    .is("deleted_at" as never, null as never)
    .order("sent_at" as never, { ascending: false })
    .limit(24);

  let alertQuery = supabase
    .from("exec_alerts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("category", "risk_command")
    .is("deleted_at", null)
    .is("resolved_at", null)
    .order("score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(24);

  if (facilityId) {
    facilityQuery = facilityQuery.eq("id", facilityId);
    snapshotQuery = snapshotQuery.eq("facility_id" as never, facilityId as never);
    deliveryQuery = deliveryQuery.eq("facility_id" as never, facilityId as never);
    alertQuery = alertQuery.eq("facility_id", facilityId);
  }

  const [facilityRes, snapshotRes, deliveryRes, alertRes] = await Promise.all([
    facilityQuery,
    snapshotQuery,
    deliveryQuery,
    alertQuery,
  ]);

  if (facilityRes.error) throw facilityRes.error;
  if (snapshotRes.error) throw snapshotRes.error;
  if (deliveryRes.error) throw deliveryRes.error;
  if (alertRes.error) throw alertRes.error;

  const facilities = (facilityRes.data ?? []) as RiskFacilityMini[];
  const facilityNameMap = new Map(facilities.map((row) => [row.id, row.name]));
  const historyRows = (snapshotRes.data ?? []) as unknown as RiskSnapshotRow[];

  const latestByFacility = new Map<string, RiskSnapshotRow>();
  for (const row of historyRows) {
    if (!latestByFacility.has(row.facility_id)) {
      latestByFacility.set(row.facility_id, row);
    }
  }

  const latestRows = Array.from(latestByFacility.values())
    .map((row) => ({
      ...row,
      facilityName: facilityNameMap.get(row.facility_id) ?? row.facility_id,
      topDrivers: Array.isArray(row.summary_json?.top_drivers) ? row.summary_json.top_drivers : [],
    }))
    .sort((left, right) => left.risk_score - right.risk_score);

  const recentDeliveries = ((deliveryRes.data ?? []) as unknown as RiskDeliveryRow[]).map((row) => ({
    ...row,
    facilityName: row.facility_id ? (facilityNameMap.get(row.facility_id) ?? row.facility_id) : "Portfolio",
  }));

  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const smsSent24h = recentDeliveries.filter(
    (row) => row.channel === "sms" && row.delivery_status === "sent" && new Date(row.sent_at).getTime() >= cutoffMs,
  ).length;

  return {
    facilities,
    latestRows,
    historyRows,
    recentDeliveries,
    openAlerts: (alertRes.data ?? []) as ExecutiveAlertRow[],
    smsSent24h,
  };
}
