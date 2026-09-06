import type { SupabaseClient } from "@supabase/supabase-js";

import {
  facilityDateIsoDaysFromToday,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";

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
  checkedAt: string;
  lastSurveyAvailable: boolean;
  documentCount: number | null;
  expiringSoonCount: number | null;
  inservicesThisYear: number | null;
  drillsDueSoon: number | null;
  lastSurvey: { date: string; type: string; result: string } | null;
};

/** Preserve unknown separately from a confirmed zero count. */
async function countWindow(
  supabase: SupabaseClient,
  table: string,
  facilityId: string,
  column: string | null,
  startIso: string | null,
  endIso: string | null,
): Promise<number | null> {
  try {
    let q = supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId)
      .is("deleted_at", null);
    if (column && startIso) q = q.gte(column, startIso);
    if (column && endIso) q = q.lte(column, endIso);
    const res = (await q) as unknown as { count: number | null; error: unknown };
    if (res.error) return null;
    return res.count;
  } catch {
    return null;
  }
}

export type BinderEvidenceDateWindow = {
  todayIso: string;
  in60Iso: string;
  yearStartIso: string;
};

/** Eastern calendar windows for expiring-soon, drills-due, and in-services YTD counts. */
export function binderEvidenceDateWindow(now: Date = new Date()): BinderEvidenceDateWindow {
  const todayIso = todayFacilityDateIso(now);
  return {
    todayIso,
    in60Iso: facilityDateIsoDaysFromToday(60, now),
    yearStartIso: `${todayIso.slice(0, 4)}-01-01`,
  };
}

/** Fetch live readiness evidence for a facility. Defensive: never throws. */
export async function fetchBinderEvidence(
  supabase: SupabaseClient,
  facilityId: string,
  now: Date = new Date(),
): Promise<BinderEvidence> {
  const { todayIso, in60Iso, yearStartIso } = binderEvidenceDateWindow(now);

  const [documentCount, expiringSoonCount, inservicesThisYear, drillsDueSoon] = await Promise.all([
    countWindow(supabase, "facility_documents", facilityId, null, null, null),
    countWindow(supabase, "facility_documents", facilityId, "expiration_date", todayIso, in60Iso),
    countWindow(supabase, "inservice_log_sessions", facilityId, "session_date", yearStartIso, "2999-12-31"),
    countWindow(supabase, "emergency_checklist_items", facilityId, "next_due_date", todayIso, in60Iso),
  ]);

  let lastSurvey: BinderEvidence["lastSurvey"] = null;
  let lastSurveyAvailable = true;
  try {
    const res = (await supabase
      .from("facility_survey_history")
      .select("survey_date, survey_type, result")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("survey_date", { ascending: false })
      .limit(1)) as unknown as {
      data: { survey_date: string; survey_type: string; result: string }[] | null;
      error?: unknown;
    };
    if (res.error) throw res.error;
    const row = res.data?.[0];
    if (row) lastSurvey = { date: row.survey_date, type: row.survey_type, result: row.result };
  } catch {
    lastSurveyAvailable = false;
    lastSurvey = null;
  }

  return { checkedAt: now.toISOString(), lastSurveyAvailable, documentCount, expiringSoonCount, inservicesThisYear, drillsDueSoon, lastSurvey };
}
