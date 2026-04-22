/**
 * Coordinator (Resident Service Coordinator) dashboard brief.
 * Aggregates care plans, assessments, family messages, admissions pipeline.
 */

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type CoordinatorDashboardBrief = {
  activeCarePlans: number;
  reviewsDue14d: number;
  pendingAssessments: number;
  unreadFamilyMessages: number;
  activeAdmissions: number;
  recentConditionChanges: number;
  carePlansDue: Array<{ id: string; residentName: string; reviewDate: string }>;
  pendingAdmissions: Array<{ id: string; name: string; daysSinceInquiry: number }>;
};

type CountResponse = { count: number | null };
type ScopedQuery<T> = { eq(column: string, value: string): T };
type ReviewListRow = {
  id: string;
  next_review_date: string;
  residents: { first_name: string | null; last_name: string | null } | null;
};
type PendingAdmissionRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

export async function fetchCoordinatorDashboardBrief(
  facilityId: string | null,
): Promise<CoordinatorDashboardBrief> {
  const supabase = createClient();

  const f = <T extends ScopedQuery<T>>(q: T): T =>
    isValidFacilityIdForQuery(facilityId) ? q.eq("facility_id", facilityId) : q;

  const fourteenDays = new Date(Date.now() + 14 * 86400000).toISOString();

  const [
    carePlansRes,
    reviewsDueRes,
    assessmentsRes,
    messagesRes,
    admissionsRes,
    conditionRes,
    reviewsListRes,
    pendingListRes,
  ] = await Promise.all([
    f(supabase.from("care_plans" as never).select("id", { count: "exact", head: true }))
      .eq("status", "active")
      .is("deleted_at", null),
    f(supabase.from("care_plans" as never).select("id", { count: "exact", head: true }))
      .eq("status", "active")
      .lte("next_review_date", fourteenDays)
      .is("deleted_at", null),
    f(supabase.from("assessments" as never).select("id", { count: "exact", head: true }))
      .eq("status", "pending")
      .is("deleted_at", null),
    f(supabase.from("family_messages" as never).select("id", { count: "exact", head: true }))
      .eq("is_read", false)
      .is("deleted_at", null),
    f(supabase.from("residents" as never).select("id", { count: "exact", head: true }))
      .in("status", ["inquiry", "pending_admission"])
      .is("deleted_at", null),
    f(supabase.from("condition_changes" as never).select("id", { count: "exact", head: true }))
      .gte("created_at", new Date(Date.now() - 48 * 3600000).toISOString())
      .is("deleted_at", null),
    f(supabase.from("care_plans" as never).select("id, next_review_date, residents(first_name, last_name)"))
      .eq("status", "active")
      .lte("next_review_date", fourteenDays)
      .is("deleted_at", null)
      .order("next_review_date", { ascending: true })
      .limit(5),
    f(supabase.from("residents" as never).select("id, first_name, last_name, created_at"))
      .in("status", ["inquiry", "pending_admission"])
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(5),
  ]);

  const carePlansDue = ((reviewsListRes.data ?? []) as ReviewListRow[]).map((review) => ({
    id: review.id,
    residentName:
      `${review.residents?.first_name ?? ""} ${review.residents?.last_name ?? ""}`.trim() || "Unknown",
    reviewDate: review.next_review_date,
  }));

  const pendingAdmissions = ((pendingListRes.data ?? []) as PendingAdmissionRow[]).map((resident) => ({
    id: resident.id,
    name: `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() || "Unknown",
    daysSinceInquiry: Math.round((Date.now() - new Date(resident.created_at).getTime()) / 86400000),
  }));

  return {
    activeCarePlans: (carePlansRes as CountResponse).count ?? 0,
    reviewsDue14d: (reviewsDueRes as CountResponse).count ?? 0,
    pendingAssessments: (assessmentsRes as CountResponse).count ?? 0,
    unreadFamilyMessages: (messagesRes as CountResponse).count ?? 0,
    activeAdmissions: (admissionsRes as CountResponse).count ?? 0,
    recentConditionChanges: (conditionRes as CountResponse).count ?? 0,
    carePlansDue,
    pendingAdmissions,
  };
}
