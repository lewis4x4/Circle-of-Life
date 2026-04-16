import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

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
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
}

export async function fetchCarePlanReviewsDue(selectedFacilityId: string | null): Promise<CarePlanReviewDueRow[]> {
  const today = easternDateString();
  const supabase = createClient();
  let q = supabase
    .from("care_plans" as never)
    .select("id, resident_id, facility_id, version, status, effective_date, review_due_date")
    .is("deleted_at", null)
    .eq("status", "active")
    .lte("review_due_date", today)
    .order("review_due_date", { ascending: true })
    .limit(500);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryListResult<SupabasePlan>;
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
    const resident = resById.get(p.resident_id);
    const residentName = resident
      ? `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() || "Unknown"
      : "Unknown";
    const dueMs = parseISODateOnly(p.review_due_date);
    const daysOverdue =
      Number.isNaN(dueMs) || Number.isNaN(todayMs) ? 0 : Math.max(0, Math.round((todayMs - dueMs) / 86400000));

    return {
      id: p.id,
      residentId: p.resident_id,
      residentName,
      version: p.version ?? 1,
      status: p.status,
      effectiveDate: formatCarePlanReviewDate(p.effective_date),
      reviewDueDate: formatCarePlanReviewDate(p.review_due_date),
      daysOverdue,
    };
  });
}
