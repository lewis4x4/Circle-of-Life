import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatReviewsDueAlertReason,
  formatReviewsDueDateReason,
  formatReviewsDueResidentLabel,
} from "@/lib/care-plans/reviews-due-display-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type CarePlanReviewReason = {
  kind: "review_due" | "alert";
  label: string;
  /** Present for alert reasons; the PATCH target for acknowledge / dismiss. */
  alertId?: string;
  alertStatus?: "open" | "acknowledged";
  triggerType?: string;
};

export type CarePlanReviewDueRow = {
  id: string;
  residentId: string;
  residentName: string;
  version: number;
  status: string;
  effectiveDate: string;
  reviewDueDate: string;
  /** 0 when the review date is today or still ahead (alert-only rows). */
  daysOverdue: number;
  reasons: CarePlanReviewReason[];
};

export type SupabasePlan = {
  id: string;
  resident_id: string;
  facility_id: string;
  version: number | null;
  status: string;
  effective_date: string;
  review_due_date: string;
};

export type SupabaseReviewAlert = {
  id: string;
  care_plan_id: string;
  trigger_type: string;
  trigger_detail: string | null;
  status: string;
  created_at: string;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

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

export function formatCarePlanReviewDate(iso: string): string {
  const t = parseISODateOnly(iso);
  if (Number.isNaN(t)) return iso;
  // `t` is UTC midnight of a stored calendar date: format it in UTC so it stays that day.
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(t));
}

/**
 * One row per active plan that is either past its review date or carries an
 * open alert. Date rows sort first by how overdue they are; alert-only rows
 * follow, newest alert first. Pure so the shaping is testable without Supabase.
 */
export function mergeCarePlanReviewRows(input: {
  duePlans: SupabasePlan[];
  alertPlans: SupabasePlan[];
  alerts: SupabaseReviewAlert[];
  residents: SupabaseResidentMini[];
  today: string;
}): CarePlanReviewDueRow[] {
  const todayMs = parseISODateOnly(input.today);
  const resById = new Map(input.residents.map((r) => [r.id, r] as const));
  const plansById = new Map<string, SupabasePlan>();
  for (const plan of [...input.duePlans, ...input.alertPlans]) plansById.set(plan.id, plan);
  const dueIds = new Set(input.duePlans.map((p) => p.id));

  const alertsByPlan = new Map<string, SupabaseReviewAlert[]>();
  for (const alert of input.alerts) {
    if (!plansById.has(alert.care_plan_id)) continue;
    const list = alertsByPlan.get(alert.care_plan_id) ?? [];
    list.push(alert);
    alertsByPlan.set(alert.care_plan_id, list);
  }

  const rows: CarePlanReviewDueRow[] = [];
  const latestAlertMs = new Map<string, number>();
  for (const plan of plansById.values()) {
    const alerts = alertsByPlan.get(plan.id) ?? [];
    if (!dueIds.has(plan.id) && alerts.length === 0) continue;

    const dueMs = parseISODateOnly(plan.review_due_date);
    const daysOverdue =
      Number.isNaN(dueMs) || Number.isNaN(todayMs) ? 0 : Math.max(0, Math.round((todayMs - dueMs) / 86400000));

    const reasons: CarePlanReviewReason[] = [];
    if (dueIds.has(plan.id)) {
      reasons.push({ kind: "review_due", label: formatReviewsDueDateReason(daysOverdue) });
    }
    const sortedAlerts = [...alerts].sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const alert of sortedAlerts) {
      reasons.push({
        kind: "alert",
        label: formatReviewsDueAlertReason(alert.trigger_type, alert.trigger_detail),
        alertId: alert.id,
        alertStatus: alert.status === "acknowledged" ? "acknowledged" : "open",
        triggerType: alert.trigger_type,
      });
    }

    rows.push({
      id: plan.id,
      residentId: plan.resident_id,
      residentName: formatReviewsDueResidentLabel(resById.get(plan.resident_id)),
      version: plan.version ?? 1,
      status: plan.status,
      effectiveDate: formatCarePlanReviewDate(plan.effective_date),
      reviewDueDate: formatCarePlanReviewDate(plan.review_due_date),
      daysOverdue,
      reasons,
    });
    latestAlertMs.set(plan.id, sortedAlerts[0] ? new Date(sortedAlerts[0].created_at).getTime() : 0);
  }

  rows.sort((a, b) => {
    const aDue = dueIds.has(a.id) ? 1 : 0;
    const bDue = dueIds.has(b.id) ? 1 : 0;
    if (aDue !== bDue) return bDue - aDue;
    if (aDue && bDue && a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
    return (latestAlertMs.get(b.id) ?? 0) - (latestAlertMs.get(a.id) ?? 0);
  });

  return rows;
}

export async function fetchCarePlanReviewsDue(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<CarePlanReviewDueRow[]> {
  const today = easternDateString();
  const facilityScoped = isValidFacilityIdForQuery(selectedFacilityId);

  let dueQuery = supabase
    .from("care_plans" as never)
    .select("id, resident_id, facility_id, version, status, effective_date, review_due_date")
    .is("deleted_at", null)
    .eq("status", "active")
    .lte("review_due_date", today)
    .order("review_due_date", { ascending: true })
    .limit(500);
  if (facilityScoped) dueQuery = dueQuery.eq("facility_id", selectedFacilityId);

  let alertQuery = supabase
    .from("care_plan_review_alerts" as never)
    .select("id, care_plan_id, trigger_type, trigger_detail, status, created_at")
    .is("deleted_at", null)
    .in("status", ["open", "acknowledged"])
    .order("created_at", { ascending: false })
    .limit(500);
  if (facilityScoped) alertQuery = alertQuery.eq("facility_id", selectedFacilityId);

  const [dueRes, alertRes] = (await Promise.all([dueQuery, alertQuery])) as unknown as [
    QueryListResult<SupabasePlan>,
    QueryListResult<SupabaseReviewAlert>,
  ];
  if (dueRes.error) throw dueRes.error;
  if (alertRes.error) throw alertRes.error;
  const duePlans = dueRes.data ?? [];
  const alerts = alertRes.data ?? [];

  const duePlanIds = new Set(duePlans.map((p) => p.id));
  const alertOnlyPlanIds = [...new Set(alerts.map((a) => a.care_plan_id).filter((id) => !duePlanIds.has(id)))];
  let alertPlans: SupabasePlan[] = [];
  if (alertOnlyPlanIds.length > 0) {
    const alertPlanRes = (await supabase
      .from("care_plans" as never)
      .select("id, resident_id, facility_id, version, status, effective_date, review_due_date")
      .in("id", alertOnlyPlanIds)
      .eq("status", "active")
      .is("deleted_at", null)) as unknown as QueryListResult<SupabasePlan>;
    if (alertPlanRes.error) throw alertPlanRes.error;
    alertPlans = alertPlanRes.data ?? [];
  }

  if (duePlans.length === 0 && alertPlans.length === 0) return [];

  const residentIds = [...new Set([...duePlans, ...alertPlans].map((p) => p.resident_id))];
  const resRes = (await supabase
    .from("residents" as never)
    .select("id, first_name, last_name")
    .in("id", residentIds)
    .is("deleted_at", null)) as unknown as QueryListResult<SupabaseResidentMini>;
  if (resRes.error) throw resRes.error;

  return mergeCarePlanReviewRows({ duePlans, alertPlans, alerts, residents: resRes.data ?? [], today });
}

/**
 * Active care plans in scope (COL-649). An empty review queue over zero plans
 * is "no plans exist", not "0 overdue". RLS limits an unscoped read to the
 * caller's facilities, the same scope as fetchCarePlanReviewsDue.
 */
export async function fetchActiveCarePlanCount(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<number> {
  let query = supabase
    .from("care_plans" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("status", "active");
  if (isValidFacilityIdForQuery(selectedFacilityId)) query = query.eq("facility_id", selectedFacilityId);
  const res = (await query) as unknown as { count: number | null; error: QueryError | null };
  if (res.error) throw res.error;
  if (typeof res.count !== "number") throw new Error("Care plan count unavailable");
  return res.count;
}
