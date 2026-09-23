"use client";

import { useMemo } from "react";

import { fetchMyWitnessTasks } from "@/lib/care-events/witness";
import { fetchFloorCensus, fetchFloorTasks, fetchMyStaffIds, fetchResidentStatusSignals } from "@/lib/floor/floor-data";
import { fetchShiftActivity } from "@/lib/floor/shift-strip";
import { floorShiftWindow } from "@/lib/floor/shift-window";

import { useFloorSession } from "./FloorContext";
import { useFloorQuery } from "./useFloorQuery";

/**
 * The reads behind Now, each its own state machine so one slow or failed read
 * never blanks the others: the facility's checks, the census, resident
 * statuses, my witness tasks, and my shift so far.
 */
export function useFloorNowData(now: Date | null) {
  const { supabase, facility, profile } = useFloorSession();
  const facilityId = facility.facilityId;
  const userId = profile.userId;
  const windowStart = useMemo(() => (now ? floorShiftWindow(facility, now) : null), [facility, now]);
  // The shift start only changes at handoff; keying on it refetches then.
  const since = windowStart?.startIso ?? null;

  const tasks = useFloorQuery(`tasks:${facilityId}`, () => fetchFloorTasks({ facilityId }), 20_000);
  const census = useFloorQuery(`census:${facilityId}`, () => fetchFloorCensus(supabase, facilityId), 5 * 60_000);
  const signals = useFloorQuery(`signals:${facilityId}`, () => fetchResidentStatusSignals(supabase, facilityId), 60_000);
  const witness = useFloorQuery(`witness:${userId}`, () => fetchMyWitnessTasks(supabase, userId), 60_000);
  const staffIds = useFloorQuery(`staff:${userId}`, () => fetchMyStaffIds(supabase, userId), 10 * 60_000);
  const staffList = staffIds.state.status === "success" ? staffIds.state.data : null;
  const activity = useFloorQuery(
    since && staffList ? `activity:${userId}:${since}` : null,
    () => fetchShiftActivity(supabase, { userId, staffIds: staffList ?? [], facilityId, sinceIso: since as string }),
    60_000,
  );

  return { windowStart, tasks, census, signals, witness, staffIds, activity };
}
