import { createClient } from "@/lib/supabase/server";

export type V2ListId = "residents" | "incidents" | "alerts" | "admissions";

export const V2_LIST_IDS: readonly V2ListId[] = [
  "residents",
  "incidents",
  "alerts",
  "admissions",
] as const;

export function isV2ListId(value: string): value is V2ListId {
  return (V2_LIST_IDS as readonly string[]).includes(value);
}

export type V2ListRow = {
  id: string;
  primary: string;
  facilityId: string | null;
  facilityName: string | null;
  status: string | null;
  /** Optional secondary line — diagnosis, category, etc. */
  secondary?: string | null;
  /** Optional severity classification mapped to row tone. */
  severity?: "high" | "medium" | "low" | null;
  /** ISO timestamp surfaced as a relative-time column. */
  occurredAt?: string | null;
  /** Free-form metadata badges (e.g., "AHCA reportable"). */
  badges?: string[];
};

export type V2ListLoad = {
  listId: V2ListId;
  rows: V2ListRow[];
  source: "live" | "fixture";
  generatedAt: string;
};

const FIXED_NOW = "2026-04-25T03:00:00-04:00";

const FIXTURE_FALLBACK: Record<V2ListId, V2ListRow[]> = {
  residents: [
    { id: "r-fix-1", primary: "Sample Resident", facilityId: null, facilityName: "Oakridge ALF", status: "active", secondary: "Heart failure" },
  ],
  incidents: [
    { id: "i-fix-1", primary: "INC-DEMO-1", facilityId: null, facilityName: "Oakridge ALF", status: "open", severity: "medium", secondary: "Fall — no injury", occurredAt: FIXED_NOW },
  ],
  alerts: [
    { id: "a-fix-1", primary: "Variance trending up", facilityId: null, facilityName: "Oakridge ALF", status: "new", severity: "medium", secondary: "eMAR variance" },
  ],
  admissions: [
    { id: "ad-fix-1", primary: "—", facilityId: null, facilityName: "Oakridge ALF", status: "pending", secondary: "Admission case" },
  ],
};

type SupabaseRow = Record<string, unknown>;
type ListResult = { data: SupabaseRow[] | null; error: { message: string } | null };

const VIEW_FOR: Record<V2ListId, string> = {
  residents: "vw_v2_residents_list",
  incidents: "vw_v2_incidents_list",
  alerts: "vw_v2_alerts_list",
  admissions: "vw_v2_admissions_list",
};

const SELECTS: Record<V2ListId, string> = {
  residents:
    "resident_id, facility_id, facility_name, resident_name, resident_status, primary_diagnosis, discharge_date, updated_at",
  incidents:
    "incident_id, facility_id, facility_name, incident_number, category, severity, incident_status, occurred_at, location_description, injury_occurred, ahca_reportable, ahca_reported, resolved_at",
  alerts:
    "alert_id, facility_id, facility_name, title, category, severity, status, source_metric_code, first_triggered_at, acknowledged_at, resolved_at",
  admissions:
    "admission_case_id, facility_id, facility_name, resident_id, resident_name, admission_status, target_move_in_date, financial_clearance_at, physician_orders_received_at, updated_at",
};

const ORDER_BY: Record<V2ListId, string> = {
  residents: "resident_name",
  incidents: "occurred_at",
  alerts: "first_triggered_at",
  admissions: "target_move_in_date",
};

const ORDER_DESC: Record<V2ListId, boolean> = {
  residents: false,
  incidents: true,
  alerts: true,
  admissions: false,
};

export async function loadV2List(listId: V2ListId): Promise<V2ListLoad> {
  const supabase = await createClient();
  const result = (await supabase
    .schema("haven" as never)
    .from(VIEW_FOR[listId] as never)
    .select(SELECTS[listId])
    .order(ORDER_BY[listId] as never, { ascending: !ORDER_DESC[listId] })) as unknown as ListResult;

  if (!result.error && Array.isArray(result.data) && result.data.length > 0) {
    return {
      listId,
      rows: mapRows(listId, result.data),
      source: "live",
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    listId,
    rows: FIXTURE_FALLBACK[listId],
    source: "fixture",
    generatedAt: FIXED_NOW,
  };
}

function mapRows(listId: V2ListId, rows: SupabaseRow[]): V2ListRow[] {
  switch (listId) {
    case "residents":
      return rows.map((row) => ({
        id: String(row.resident_id ?? ""),
        primary: String(row.resident_name ?? "—").trim() || "Unnamed resident",
        facilityId: (row.facility_id as string | null) ?? null,
        facilityName: (row.facility_name as string | null) ?? null,
        status: (row.resident_status as string | null) ?? null,
        secondary: (row.primary_diagnosis as string | null) ?? null,
      }));
    case "incidents":
      return rows.map((row) => ({
        id: String(row.incident_id ?? ""),
        primary: String(row.incident_number ?? row.incident_id ?? ""),
        facilityId: (row.facility_id as string | null) ?? null,
        facilityName: (row.facility_name as string | null) ?? null,
        status: (row.incident_status as string | null) ?? null,
        secondary: (row.category as string | null) ?? null,
        severity: normalizeSeverity(row.severity as string | null),
        occurredAt: (row.occurred_at as string | null) ?? null,
        badges: buildIncidentBadges(row),
      }));
    case "alerts":
      return rows.map((row) => ({
        id: String(row.alert_id ?? ""),
        primary: String(row.title ?? "Alert"),
        facilityId: (row.facility_id as string | null) ?? null,
        facilityName: (row.facility_name as string | null) ?? null,
        status: (row.status as string | null) ?? null,
        secondary: (row.category as string | null) ?? (row.source_metric_code as string | null) ?? null,
        severity: normalizeSeverity(row.severity as string | null),
        occurredAt: (row.first_triggered_at as string | null) ?? null,
      }));
    case "admissions":
      return rows.map((row) => ({
        id: String(row.admission_case_id ?? ""),
        primary: String(row.resident_name ?? "—").trim() || "Unnamed resident",
        facilityId: (row.facility_id as string | null) ?? null,
        facilityName: (row.facility_name as string | null) ?? null,
        status: (row.admission_status as string | null) ?? null,
        secondary: (row.target_move_in_date as string | null) ?? null,
      }));
    default:
      return [];
  }
}

function normalizeSeverity(value: string | null): "high" | "medium" | "low" | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes("high") || v.includes("critical")) return "high";
  if (v.includes("medium") || v.includes("moderate")) return "medium";
  if (v.includes("low") || v.includes("minor")) return "low";
  return null;
}

function buildIncidentBadges(row: SupabaseRow): string[] {
  const badges: string[] = [];
  if (row.injury_occurred === true) badges.push("Injury");
  if (row.ahca_reportable === true) {
    badges.push(row.ahca_reported === true ? "AHCA reported" : "AHCA reportable");
  }
  return badges;
}
