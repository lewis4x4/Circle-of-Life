/**
 * Housekeeper dashboard brief.
 * Room cleaning tasks, priority cleans, hours, completion rate.
 * Task-driven interface for Plantation-only role.
 */

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type HousekeeperDashboardBrief = {
  roomsAssigned: number;
  roomsCompleted: number;
  priorityCleans: number;
  hoursThisWeek: number;
  completionPct: number;
  tasks: Array<{
    id: string;
    roomNumber: string;
    residentName: string;
    taskType: string;
    status: string;
    isPriority: boolean;
  }>;
};

type RoomRow = { id: string; room_number: string };
type TimeRecordRow = { clock_in: string | null; clock_out: string | null };

export async function fetchHousekeepingBrief(
  facilityId: string | null,
): Promise<HousekeeperDashboardBrief> {
  const supabase = createClient();

  const weekStart = new Date(Date.now() - 7 * 86400000).toISOString();

  // Housekeeping tasks from transport_requests (repurposed for housekeeping)
  // or a dedicated table. For now, aggregate from time_records and rooms.
  let roomsQuery = supabase
    .from("rooms" as never)
    .select("id, room_number")
    .is("deleted_at", null);
  if (isValidFacilityIdForQuery(facilityId)) {
    roomsQuery = roomsQuery.eq("facility_id", facilityId);
  }
  const roomsRes = await roomsQuery;
  const roomsCount = ((roomsRes.data ?? []) as RoomRow[]).length;

  // Time records for hours this week
  let hoursQuery = supabase
    .from("time_records" as never)
    .select("clock_in, clock_out")
    .gte("clock_in", weekStart)
    .is("deleted_at", null);
  if (isValidFacilityIdForQuery(facilityId)) {
    hoursQuery = hoursQuery.eq("facility_id", facilityId);
  }
  const hoursRes = await hoursQuery;
  let totalMinutes = 0;
  for (const rec of (hoursRes.data ?? []) as TimeRecordRow[]) {
    if (rec.clock_in && rec.clock_out) {
      totalMinutes += (new Date(rec.clock_out).getTime() - new Date(rec.clock_in).getTime()) / 60000;
    }
  }
  const hoursThisWeek = Math.round((totalMinutes / 60) * 10) / 10;

  return {
    roomsAssigned: roomsCount,
    roomsCompleted: 0,
    priorityCleans: 0,
    hoursThisWeek,
    completionPct: roomsCount > 0 ? 0 : 100,
    tasks: [],
  };
}
