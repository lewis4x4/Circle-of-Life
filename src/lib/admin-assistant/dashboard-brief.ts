/**
 * Admin Assistant (Front Desk) dashboard brief.
 * Aggregates census count, pending docs, messages, upcoming appointments.
 * NO clinical data, NO financial data.
 */

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type AdminAssistantDashboardBrief = {
  censusCount: number;
  pendingDocs: number;
  unreadMessages: number;
  transportationToday: number;
  recentMessages: Array<{
    id: string;
    from: string;
    preview: string;
    createdAt: string;
  }>;
};

export async function fetchAdminAssistantDashboardBrief(
  facilityId: string | null,
): Promise<AdminAssistantDashboardBrief> {
  const supabase = createClient();

  const f = (q: any) =>
    isValidFacilityIdForQuery(facilityId) ? q.eq("facility_id", facilityId) : q;

  const todayStart = new Date().toISOString().split("T")[0] + "T00:00:00";

  const [
    censusRes,
    docsRes,
    messagesRes,
    transportRes,
    recentMsgRes,
  ] = await Promise.all([
    f(supabase.from("residents" as never).select("id", { count: "exact", head: true }))
      .eq("status", "active")
      .is("deleted_at", null),
    f(supabase.from("documents" as never).select("id", { count: "exact", head: true }))
      .eq("status", "pending")
      .is("deleted_at", null),
    f(supabase.from("family_messages" as never).select("id", { count: "exact", head: true }))
      .eq("is_read", false)
      .is("deleted_at", null),
    f(supabase.from("transport_requests" as never).select("id", { count: "exact", head: true }))
      .gte("scheduled_time", todayStart)
      .is("deleted_at", null),
    f(supabase.from("family_messages" as never).select("id, subject, sender_name, created_at"))
      .eq("is_read", false)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const recentMessages = (recentMsgRes as any).data?.map((m: any) => ({
    id: m.id,
    from: m.sender_name ?? "Family member",
    preview: m.subject ?? "No subject",
    createdAt: m.created_at,
  })) ?? [];

  return {
    censusCount: (censusRes as any).count ?? 0,
    pendingDocs: (docsRes as any).count ?? 0,
    unreadMessages: (messagesRes as any).count ?? 0,
    transportationToday: (transportRes as any).count ?? 0,
    recentMessages,
  };
}
