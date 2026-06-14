import type { SupabaseClient } from "@supabase/supabase-js";

export type BinderCategory =
  | "admin_records"
  | "staff_records"
  | "resident_records"
  | "medication"
  | "food_service"
  | "physical_plant"
  | "emergency_preparedness"
  | "policies"
  | "other";

export type BinderStatus = "ready" | "in_progress" | "missing" | "not_applicable";

export const BINDER_CATEGORIES: { id: BinderCategory; label: string }[] = [
  { id: "admin_records", label: "Administrative records" },
  { id: "staff_records", label: "Staff records" },
  { id: "resident_records", label: "Resident records" },
  { id: "medication", label: "Medication" },
  { id: "food_service", label: "Food service" },
  { id: "physical_plant", label: "Physical plant" },
  { id: "emergency_preparedness", label: "Emergency preparedness" },
  { id: "policies", label: "Policies & procedures" },
  { id: "other", label: "Other" },
];

export type BinderItemRow = {
  id: string;
  category: BinderCategory;
  title: string;
  status: BinderStatus;
  note: string | null;
  source_url: string | null;
  sort_order: number;
};

export function binderCategoryLabel(id: string): string {
  return BINDER_CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}

export function binderStatusTone(
  status: BinderStatus,
): "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "ready":
      return "success";
    case "in_progress":
      return "warning";
    case "missing":
      return "danger";
    default:
      return "muted";
  }
}

export type BinderEvidence = {
  documentCount: number;
  expiringSoonCount: number;
  inservicesThisYear: number;
  drillsDueSoon: number;
  lastSurvey: { date: string; type: string; result: string } | null;
};

/** Windowed exact count that tolerates per-source errors (returns 0). */
async function countWindow(
  supabase: SupabaseClient,
  table: string,
  facilityId: string,
  column: string | null,
  startIso: string | null,
  endIso: string | null,
): Promise<number> {
  try {
    let q = supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId)
      .is("deleted_at", null);
    if (column && startIso) q = q.gte(column, startIso);
    if (column && endIso) q = q.lte(column, endIso);
    const res = (await q) as unknown as { count: number | null; error: unknown };
    if (res.error) return 0;
    return res.count ?? 0;
  } catch {
    return 0;
  }
}

/** Fetch live readiness evidence for a facility. Defensive: never throws. */
export async function fetchBinderEvidence(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<BinderEvidence> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const in60Iso = new Date(Date.now() + 60 * 86400 * 1000).toISOString().slice(0, 10);
  const yearStartIso = `${new Date().getFullYear()}-01-01`;

  const [documentCount, expiringSoonCount, inservicesThisYear, drillsDueSoon] = await Promise.all([
    countWindow(supabase, "facility_documents", facilityId, null, null, null),
    countWindow(supabase, "facility_documents", facilityId, "expiration_date", todayIso, in60Iso),
    countWindow(supabase, "inservice_log_sessions", facilityId, "session_date", yearStartIso, "2999-12-31"),
    countWindow(supabase, "emergency_checklist_items", facilityId, "next_due_date", todayIso, in60Iso),
  ]);

  let lastSurvey: BinderEvidence["lastSurvey"] = null;
  try {
    const res = (await supabase
      .from("facility_survey_history")
      .select("survey_date, survey_type, result")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("survey_date", { ascending: false })
      .limit(1)) as unknown as {
      data: { survey_date: string; survey_type: string; result: string }[] | null;
    };
    const row = res.data?.[0];
    if (row) lastSurvey = { date: row.survey_date, type: row.survey_type, result: row.result };
  } catch {
    lastSurvey = null;
  }

  return { documentCount, expiringSoonCount, inservicesThisYear, drillsDueSoon, lastSurvey };
}
