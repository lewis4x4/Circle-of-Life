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

export async function fetchCoordinatorDashboardBrief(
  facilityId: string | null,
): Promise<CoordinatorDashboardBrief> {
  const supabase = createClient();

  const f = (q: any) =>
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

  const carePlansDue = (reviewsListRes as any).data?.map((r: any) => ({
    id: r.id,
    residentName: `${r.residents?.first_name ?? ""} ${r.residents?.last_name ?? ""}`.trim() || "Unknown",
    reviewDate: r.next_review_date,
  })) ?? [];

  const pendingAdmissions = (pendingListRes as any).data?.map((r: any) => ({
    id: r.id,
    name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unknown",
    daysSinceInquiry: Math.round((Date.now() - new Date(r.created_at).getTime()) / 86400000),
  })) ?? [];

  return {
    activeCarePlans: (carePlansRes as any).count ?? 0,
    reviewsDue14d: (reviewsDueRes as any).count ?? 0,
    pendingAssessments: (assessmentsRes as any).count ?? 0,
    unreadFamilyMessages: (messagesRes as any).count ?? 0,
    activeAdmissions: (admissionsRes as any).count ?? 0,
    recentConditionChanges: (conditionRes as any).count ?? 0,
    carePlansDue,
    pendingAdmissions,
  };
}
