"use client";

import { useEffect, useMemo } from "react";

import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";
import { buildShiftStripItems } from "@/lib/floor/shift-strip";
import { nowCountSegments, selectNowChecks } from "@/lib/floor/now-rows";

import { useFloorSession } from "./FloorContext";
import { useFloorNow } from "./FloorClock";
import { FloorNowList } from "./FloorNowList";
import { FloorResidentsRail, SomethingHappenedButton } from "./FloorResidentsRail";
import { FloorStatePanel } from "./FloorStatePanel";
import { MyShiftStrip } from "./MyShiftStrip";
import { useFloorNowData } from "./useFloorNowData";

const NOW_REFRESH_MS = 60_000;

type Loadable = { status: string };
function simpleState(query: Loadable): "loading" | "error" | "ready" {
  return query.status === "success" ? "ready" : query.status === "error" ? "error" : "loading";
}

/**
 * `/floor`, Tier 1 (spec 40 §6 screen 3, DESIGN.md 03): what is due now for
 * the building, the signed-in person's tasks, the residents rail, "Something
 * happened", and the person's shift so far.
 */
export function FloorNowScreen() {
  const { profile, timeZone } = useFloorSession();
  const now = useFloorNow(30_000);
  const { windowStart, tasks, census, signals, witness, staffIds, activity } = useFloorNowData(now);

  // The queue moves all shift: ask again every minute while Now is open.
  const reloadTasks = tasks.reload;
  const reloadActivity = activity.reload;
  useEffect(() => {
    const timer = window.setInterval(() => {
      reloadTasks();
      reloadActivity();
    }, NOW_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reloadTasks, reloadActivity]);

  // A check charted offline waits in the outbox; it is off the list, as on the caregiver app.
  const outbox = useRoundingOfflineSync();
  const taskRows = useMemo(
    () => (tasks.state.status === "success" ? tasks.state.data.filter((row) => !outbox.queuedTaskIdSet.has(row.id)) : []),
    [tasks.state, outbox.queuedTaskIdSet],
  );
  const censusRows = useMemo(() => (census.state.status === "success" ? census.state.data : []), [census.state]);
  const roomByResident = useMemo(() => new Map(censusRows.map((resident) => [resident.id, resident.room] as const)), [censusRows]);
  const openWitness = useMemo(
    () => (witness.state.status === "success" ? witness.state.data.filter((task) => !task.completedAt) : []),
    [witness.state],
  );

  const checks = useMemo(
    () => (now && windowStart ? selectNowChecks(taskRows, now, windowStart.startIso) : []),
    [taskRows, now, windowStart],
  );

  const nextDueByResident = useMemo(() => {
    const map = new Map<string, string>();
    if (!now) return map;
    for (const row of taskRows) {
      const residentId = row.residents?.id;
      if (!residentId || row.derived_status.startsWith("completed_") || row.derived_status === "excused") continue;
      if (new Date(row.due_at).getTime() < now.getTime()) continue;
      const current = map.get(residentId);
      if (!current || row.due_at < current) map.set(residentId, row.due_at);
    }
    return map;
  }, [taskRows, now]);

  const stripItems = useMemo(() => {
    if (activity.state.status !== "success" || !now || !windowStart) return [];
    const mine = new Set(staffIds.state.status === "success" ? staffIds.state.data : []);
    // "n of m": my assigned checks due so far this shift, and how many of them are charted.
    const assignedSoFar = taskRows.filter(
      (row) =>
        row.assigned_staff_id &&
        mine.has(row.assigned_staff_id) &&
        row.due_at >= windowStart.startIso &&
        new Date(row.due_at).getTime() <= now.getTime(),
    );
    const chartedOfAssigned = assignedSoFar.filter((row) => row.derived_status.startsWith("completed_")).length;
    return buildShiftStripItems({
      clockedInAt: profile.clockedInAt,
      activity: activity.state.data,
      roundsAssigned: assignedSoFar.length > 0 ? { charted: chartedOfAssigned, due: assignedSoFar.length } : null,
      roomByResident,
    });
  }, [activity.state, staffIds.state, taskRows, now, windowStart, profile.clockedInAt, roomByResident]);

  if (!now || !windowStart) return <FloorStatePanel state="loading" title="Loading Now" pageTitle="Now" className="flex-1" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <FloorNowList
          now={now}
          timeZone={timeZone}
          checks={checks}
          checksState={simpleState(tasks.state)}
          roomByResident={roomByResident}
          tasks={openWitness}
          tasksState={simpleState(witness.state)}
          counts={nowCountSegments(checks, openWitness.length)}
          onRetryChecks={tasks.reload}
          onTaskDone={witness.reload}
        />
        <FloorResidentsRail
          census={censusRows}
          censusState={simpleState(census.state)}
          signals={signals.state.status === "success" ? signals.state.data : null}
          nextDueByResident={nextDueByResident}
          timeZone={timeZone}
          onRetry={census.reload}
        />
      </div>
      <div className="shrink-0 border-t border-border bg-chrome-secondary px-6 py-3 lg:hidden">
        <SomethingHappenedButton href="/floor/report" />
      </div>
      <MyShiftStrip
        items={stripItems}
        handoffAt={windowStart.endIso}
        timeZone={timeZone}
        state={activity.state.status === "error" || staffIds.state.status === "error" ? "error" : simpleState(activity.state)}
      />
    </div>
  );
}
