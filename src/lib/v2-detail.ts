import { createClient } from "@/lib/supabase/server";

import type { V2ListId } from "./v2-lists";

export type V2DetailIdentifier = { label: string; value: string };

export type V2DetailTone =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "regulatory";

export type V2DetailLoad = {
  listId: V2ListId;
  recordId: string;
  title: string;
  subtitle: string | null;
  status: { label: string; tone: V2DetailTone } | null;
  identifiers: V2DetailIdentifier[];
  source: "live" | "fixture";
};

const VIEW_FOR: Record<V2ListId, { view: string; idColumn: string }> = {
  residents: { view: "vw_v2_residents_list", idColumn: "resident_id" },
  incidents: { view: "vw_v2_incidents_list", idColumn: "incident_id" },
  alerts: { view: "vw_v2_alerts_list", idColumn: "alert_id" },
  admissions: { view: "vw_v2_admissions_list", idColumn: "admission_case_id" },
};

type SingleResult = { data: Record<string, unknown> | null; error: { message: string } | null };

export async function loadV2Detail(
  listId: V2ListId,
  recordId: string,
): Promise<V2DetailLoad | null> {
  const supabase = await createClient();
  const { view, idColumn } = VIEW_FOR[listId];

  const result = (await supabase
    .schema("haven" as never)
    .from(view as never)
    .select("*")
    .eq(idColumn as never, recordId as never)
    .maybeSingle()) as unknown as SingleResult;

  if (result.error || !result.data) return null;
  return mapDetail(listId, recordId, result.data);
}

function mapDetail(
  listId: V2ListId,
  recordId: string,
  row: Record<string, unknown>,
): V2DetailLoad {
  switch (listId) {
    case "residents": {
      const status = (row.resident_status as string | null) ?? null;
      return {
        listId,
        recordId,
        title: ((row.resident_name as string) ?? "").trim() || "Unnamed resident",
        subtitle: (row.facility_name as string) ?? null,
        status: status ? { label: status, tone: residentTone(status) } : null,
        identifiers: [
          { label: "Resident ID", value: recordId },
          { label: "Diagnosis", value: ((row.primary_diagnosis as string) ?? "—") || "—" },
          { label: "Discharge", value: formatDate(row.discharge_date) },
          { label: "Updated", value: formatDate(row.updated_at) },
        ],
        source: "live",
      };
    }
    case "incidents": {
      const status = (row.incident_status as string | null) ?? null;
      const sev = (row.severity as string | null) ?? null;
      return {
        listId,
        recordId,
        title: ((row.incident_number as string) ?? "Incident").trim() || "Incident",
        subtitle: ((row.location_description as string) ?? null) ?? (row.facility_name as string) ?? null,
        status: status ? { label: status, tone: incidentTone(status, sev) } : null,
        identifiers: [
          { label: "Severity", value: sev ?? "—" },
          { label: "Category", value: ((row.category as string) ?? "—") || "—" },
          { label: "Occurred", value: formatDate(row.occurred_at) },
          { label: "AHCA reportable", value: row.ahca_reportable === true ? "Yes" : "No" },
        ],
        source: "live",
      };
    }
    case "alerts": {
      const status = (row.status as string | null) ?? null;
      const sev = (row.severity as string | null) ?? null;
      return {
        listId,
        recordId,
        title: ((row.title as string) ?? "Alert").trim() || "Alert",
        subtitle: ((row.facility_name as string) ?? null) ?? null,
        status: status ? { label: status, tone: alertTone(status, sev) } : null,
        identifiers: [
          { label: "Severity", value: sev ?? "—" },
          { label: "Category", value: ((row.category as string) ?? "—") || "—" },
          { label: "First triggered", value: formatDate(row.first_triggered_at) },
          { label: "Source metric", value: ((row.source_metric_code as string) ?? "—") || "—" },
        ],
        source: "live",
      };
    }
    case "admissions": {
      const status = (row.admission_status as string | null) ?? null;
      return {
        listId,
        recordId,
        title: ((row.resident_name as string) ?? "Admission case").trim() || "Admission case",
        subtitle: (row.facility_name as string) ?? null,
        status: status ? { label: status, tone: admissionTone(status) } : null,
        identifiers: [
          { label: "Move-in target", value: formatDate(row.target_move_in_date) },
          { label: "Financial cleared", value: formatDate(row.financial_clearance_at) },
          { label: "Physician orders", value: formatDate(row.physician_orders_received_at) },
          { label: "Updated", value: formatDate(row.updated_at) },
        ],
        source: "live",
      };
    }
  }
}

function residentTone(status: string): V2DetailTone {
  switch (status.toLowerCase()) {
    case "active":
      return "success";
    case "discharge_planning":
    case "discharge planning":
      return "warning";
    case "discharged":
      return "default";
    default:
      return "default";
  }
}

function incidentTone(
  status: string,
  severity: string | null,
): V2DetailTone {
  if (severity?.toLowerCase().includes("high") || severity?.toLowerCase().includes("critical")) return "danger";
  switch (status.toLowerCase()) {
    case "open":
      return "warning";
    case "resolved":
    case "closed":
      return "success";
    default:
      return "default";
  }
}

function alertTone(
  status: string,
  severity: string | null,
): V2DetailTone {
  if (severity?.toLowerCase().includes("high") || severity?.toLowerCase().includes("critical")) return "danger";
  switch (status.toLowerCase()) {
    case "new":
      return "warning";
    case "acknowledged":
      return "info";
    case "resolved":
      return "success";
    default:
      return "default";
  }
}

function admissionTone(
  status: string,
): V2DetailTone {
  switch (status.toLowerCase()) {
    case "completed":
    case "moved_in":
      return "success";
    case "cancelled":
      return "danger";
    case "in_progress":
    case "pending":
      return "info";
    default:
      return "default";
  }
}

function formatDate(value: unknown): string {
  if (value == null) return "—";
  const s = String(value);
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 16).replace("T", " ");
}
