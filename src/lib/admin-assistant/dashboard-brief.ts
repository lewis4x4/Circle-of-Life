/**
 * Admin Assistant (Front Desk) dashboard brief.
 * Aggregates census count, pending docs, family bulletin notes, upcoming appointments.
 * NO clinical data, NO financial data.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatFamilyBulletinDashboardPreview } from "@/lib/admin/family-bulletin-dashboard-copy";
import {
  facilityDatetimeLocalToUtcIso,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";
import { headCountOrNull, type HeadCountReply } from "@/lib/metrics/head-count";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type AdminAssistantDashboardBrief = {
  /** Null when the count could not be read — never shown as 0. */
  censusCount: number | null;
  pendingDocs: number | null;
  staffBulletinNotes: number | null;
  transportationToday: number | null;
  recentBulletinNotes: Array<{
    id: string;
    preview: string;
    createdAt: string;
  }>;
};

type ScopedQuery<T> = { eq(column: string, value: string): T };
type RecentBulletinRow = {
  id: string;
  body: string | null;
  created_at: string;
};

/** Start of the front desk's Eastern today, represented for UTC timestamptz queries. */
export function transportationTodayStartUtcIso(now: Date = new Date()): string {
  return facilityDatetimeLocalToUtcIso(`${todayFacilityDateIso(now)}T00:00`);
}

export async function fetchAdminAssistantDashboardBrief(
  facilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<AdminAssistantDashboardBrief> {

  const f = <T extends ScopedQuery<T>>(q: T): T =>
    isValidFacilityIdForQuery(facilityId) ? q.eq("facility_id", facilityId) : q;

  const todayStart = transportationTodayStartUtcIso();

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
    censusCount: headCountOrNull(censusRes as HeadCountReply),
    pendingDocs: headCountOrNull(docsRes as HeadCountReply),
    staffBulletinNotes: headCountOrNull(bulletinRes as HeadCountReply),
    transportationToday: headCountOrNull(transportRes as HeadCountReply),
    recentBulletinNotes,
  };
}
