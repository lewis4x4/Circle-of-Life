import type { SupabaseClient } from "@supabase/supabase-js";

import { formatOverdueAssessmentsResidentLabel } from "@/lib/assessments/overdue-assessments-display-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type OverdueAssessmentRow = {
  id: string;
  residentId: string;
  residentName: string;
  assessmentType: string;
  assessmentDate: string;
  nextDueDate: string;
  daysOverdue: number;
  riskLevel: string | null;
  totalScore: string | null;
};

export type CarePlanReviewDueRow = {
  id: string;
  residentId: string;
  residentName: string;
  version: number;
  status: string;
  effectiveDate: string;
  reviewDueDate: string;
  daysOverdue: number;
};

type SupabaseAssessment = {
  id: string;
  resident_id: string;
  facility_id: string;
  assessment_type: string;
  assessment_date: string;
  next_due_date: string;
  risk_level: string | null;
  total_score: number | string | null;
};

type SupabasePlan = {
  id: string;
  resident_id: string;
  facility_id: string;
  version: number | null;
  status: string;
  effective_date: string;
  review_due_date: string;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

export const NO_FACILITY_SOURCE_NOTICE =
  "Select a facility to load live assessment and care-plan due queues. No cross-facility fallback query is run.";

function easternDateString(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !day) return d.toISOString().slice(0, 10);
  return `${y}-${m}-${day}`;
}

function parseISODateOnly(value: string): number {
  const [yy, mm, dd] = value.split("-").map(Number);
  if (!yy || !mm || !dd) return NaN;
  return new Date(Date.UTC(yy, mm - 1, dd)).getTime();
}

function formatDisplayDate(iso: string): string {
  const t = parseISODateOnly(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(t));
}

export async function fetchOverdueAssessmentsFromSupabase(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<OverdueAssessmentRow[]> {
  if (!isValidFacilityIdForQuery(selectedFacilityId)) return [];

  const today = easternDateString();
  const res = (await supabase
    .from("assessments" as never)
    .select(
      "id, resident_id, facility_id, assessment_type, assessment_date, next_due_date, risk_level, total_score",
    )
    .is("deleted_at", null)
    .not("next_due_date", "is", null)
    .lte("next_due_date", today)
    .eq("facility_id", selectedFacilityId)
    .order("next_due_date", { ascending: true })
    .limit(500)) as unknown as QueryListResult<SupabaseAssessment>;

  if (res.error) throw res.error;
  const assessments = res.data ?? [];
  if (assessments.length === 0) return [];

  const residentIds = [...new Set(assessments.map((a) => a.resident_id))];
  const resRes = (await supabase
    .from("residents" as never)
    .select("id, first_name, last_name")
    .in("id", residentIds)
    .is("deleted_at", null)) as unknown as QueryListResult<SupabaseResidentMini>;
  if (resRes.error) throw resRes.error;
  const resById = new Map((resRes.data ?? []).map((r) => [r.id, r] as const));

  const todayMs = parseISODateOnly(today);

  return assessments.map((a) => {
    const rm = resById.get(a.resident_id);
    const name = formatOverdueAssessmentsResidentLabel(rm);
    const dueMs = parseISODateOnly(a.next_due_date);
    const daysOverdue =
      Number.isNaN(dueMs) || Number.isNaN(todayMs)
        ? 0
        : Math.max(0, Math.round((todayMs - dueMs) / 86400000));
    const score =
      a.total_score == null
        ? null
        : typeof a.total_score === "number"
          ? String(a.total_score)
          : String(a.total_score);

    return {
      id: a.id,
      residentId: a.resident_id,
      residentName: name,
      assessmentType: a.assessment_type,
      assessmentDate: formatDisplayDate(a.assessment_date),
      nextDueDate: formatDisplayDate(a.next_due_date),
      daysOverdue,
      riskLevel: a.risk_level,
      totalScore: score,
    };
  });
}

export async function fetchCarePlanReviewsDueFromSupabase(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<CarePlanReviewDueRow[]> {
  if (!isValidFacilityIdForQuery(selectedFacilityId)) return [];

  const today = easternDateString();
  const res = (await supabase
    .from("care_plans" as never)
    .select("id, resident_id, facility_id, version, status, effective_date, review_due_date")
    .is("deleted_at", null)
    .eq("status", "active")
    .lte("review_due_date", today)
    .eq("facility_id", selectedFacilityId)
    .order("review_due_date", { ascending: true })
    .limit(500)) as unknown as QueryListResult<SupabasePlan>;

  if (res.error) throw res.error;
  const plans = res.data ?? [];
  if (plans.length === 0) return [];

  const residentIds = [...new Set(plans.map((p) => p.resident_id))];
  const resRes = (await supabase
    .from("residents" as never)
    .select("id, first_name, last_name")
    .in("id", residentIds)
    .is("deleted_at", null)) as unknown as QueryListResult<SupabaseResidentMini>;
  if (resRes.error) throw resRes.error;
  const resById = new Map((resRes.data ?? []).map((r) => [r.id, r] as const));

  const todayMs = parseISODateOnly(today);

  return plans.map((p) => {
    const rm = resById.get(p.resident_id);
    const name = formatOverdueAssessmentsResidentLabel(rm);
    const dueMs = parseISODateOnly(p.review_due_date);
    const daysOverdue =
      Number.isNaN(dueMs) || Number.isNaN(todayMs)
        ? 0
        : Math.max(0, Math.round((todayMs - dueMs) / 86400000));

    return {
      id: p.id,
      residentId: p.resident_id,
      residentName: name,
      version: p.version ?? 1,
      status: p.status,
      effectiveDate: formatDisplayDate(p.effective_date),
      reviewDueDate: formatDisplayDate(p.review_due_date),
      daysOverdue,
    };
  });
}
