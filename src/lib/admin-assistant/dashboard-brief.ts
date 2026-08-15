/**
 * Admin Assistant (Front Desk) dashboard brief.
 * Aggregates census count, pending docs, family bulletin notes, upcoming appointments.
 * NO clinical data, NO financial data.
 */

import { formatFamilyBulletinDashboardPreview } from "@/lib/admin/family-bulletin-dashboard-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type AdminAssistantDashboardBrief = {
  censusCount: number;
  pendingDocs: number;
  staffBulletinNotes: number;
  transportationToday: number;
  recentBulletinNotes: Array<{
    id: string;
    preview: string;
    createdAt: string;
  }>;
};

type CountResponse = { count: number | null };
type ScopedQuery<T> = { eq(column: string, value: string): T };
type RecentBulletinRow = {
  id: string;
  body: string | null;
  created_at: string;
};

export async function fetchAdminAssistantDashboardBrief(
  facilityId: string | null,
): Promise<AdminAssistantDashboardBrief> {
  const supabase = createClient();

  const f = <T extends ScopedQuery<T>>(q: T): T =>
    isValidFacilityIdForQuery(facilityId) ? q.eq("facility_id", facilityId) : q;

  const todayStart = new Date().toISOString().split("T")[0] + "T00:00:00";

  const [
    censusRes,
    docsRes,
    bulletinRes,
    transportRes,
    recentBulletinRes,
  ] = await Promise.all([
    f(supabase.from("residents" as never).select("id", { count: "exact", head: true }))
      .eq("status", "active")
      .is("deleted_at", null),
    f(supabase.from("documents" as never).select("id", { count: "exact", head: true }))
      .eq("status", "pending")
      .is("deleted_at", null),
    f(supabase.from("family_portal_messages" as never).select("id", { count: "exact", head: true }))
      .eq("author_kind", "staff")
      .is("deleted_at", null),
    f(supabase.from("transport_requests" as never).select("id", { count: "exact", head: true }))
      .gte("scheduled_time", todayStart)
      .is("deleted_at", null),
    f(supabase.from("family_portal_messages" as never).select("id, body, created_at"))
      .eq("author_kind", "staff")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const recentBulletinNotes = ((recentBulletinRes.data ?? []) as RecentBulletinRow[]).map((note) => ({
    id: note.id,
    preview: formatFamilyBulletinDashboardPreview(note.body),
    createdAt: note.created_at,
  }));

  return {
    censusCount: (censusRes as CountResponse).count ?? 0,
    pendingDocs: (docsRes as CountResponse).count ?? 0,
    staffBulletinNotes: (bulletinRes as CountResponse).count ?? 0,
    transportationToday: (transportRes as CountResponse).count ?? 0,
    recentBulletinNotes,
  };
}
