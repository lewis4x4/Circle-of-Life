import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type ScheduleRow = {
  id: string;
  weekStartDate: string;
  status: string;
  publishedAt: string | null;
  notes: string | null;
};

type SupabaseScheduleRow = {
  id: string;
  week_start_date: string;
  status: string;
  published_at: string | null;
  notes: string | null;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export async function fetchSchedulesFromSupabase(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<ScheduleRow[]> {
  let q = supabase
    .from("schedules" as never)
    .select("id, week_start_date, status, published_at, notes, deleted_at")
    .is("deleted_at", null)
    .order("week_start_date", { ascending: false })
    .limit(120);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryResult<SupabaseScheduleRow>;
  if (res.error) throw res.error;
  const list = res.data ?? [];
  return list.map((r) => ({
    id: r.id,
    weekStartDate: r.week_start_date,
    status: r.status,
    publishedAt: r.published_at,
    notes: r.notes,
  }));
}
