"use client";

import { useEffect, useMemo } from "react";

import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";
import { fetchFloorCensus, fetchFloorTasks } from "@/lib/floor/floor-data";
import { FLOOR_CHECK_NAME, groupRoundsQueue, type NowCheck } from "@/lib/floor/now-rows";
import { floorShiftWindow } from "@/lib/floor/shift-window";
import { formatDisplayTime } from "@/lib/format/datetime";

import { useFloorSession } from "./FloorContext";
import { useFloorNow } from "./FloorClock";
import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_SECTION_LABEL } from "./floor-styles";
import { NowRow } from "./NowRow";
import { useFloorQuery } from "./useFloorQuery";

function Group({ title, checks, rooms, timeZone }: { title: string; checks: readonly NowCheck[]; rooms: ReadonlyMap<string, string | null>; timeZone: string }) {
  if (checks.length === 0) return null;
  return (
    <section aria-label={title} className="mt-3.5">
      <h2 className={FLOOR_SECTION_LABEL}>
        {title} <span className="tabular-nums">{checks.length}</span>
      </h2>
      <div className="mt-1.5 border-t border-border">
        {checks.map((check) => (
          <NowRow
            key={check.id}
            place={(check.residentId ? rooms.get(check.residentId) : null) ?? ""}
            title={check.residentName}
            subtitle={FLOOR_CHECK_NAME}
            dueLabel={formatDisplayTime(check.dueAt, { timeZone })}
            pill={{ label: check.timing.label, tone: check.timing.tone }}
            bar={check.timing.bar}
            primaryAction={check.timing.primaryAction}
            doneHref={check.timing.kind === "done" ? undefined : `/floor/check/${check.id}`}
            doneLabel={`Chart ${FLOOR_CHECK_NAME.toLowerCase()} for ${check.residentName}`}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * `/floor/rounds` (spec 40 §6 screen 7): the building's rounding queue for the
 * shift in force, over, due, coming up and charted, in the Now row language.
 * Checks waiting in this tablet's outbox are left out, as on the caregiver app.
 */
export function FloorRoundsScreen() {
  const { supabase, facility, timeZone } = useFloorSession();
  const facilityId = facility.facilityId;
  const now = useFloorNow(30_000);
  const outbox = useRoundingOfflineSync();
  const tasks = useFloorQuery(`tasks:${facilityId}`, () => fetchFloorTasks({ facilityId }), 20_000);
  const census = useFloorQuery(`census:${facilityId}`, () => fetchFloorCensus(supabase, facilityId), 5 * 60_000);
  const reloadTasks = tasks.reload;
  useEffect(() => {
    const timer = window.setInterval(reloadTasks, 60_000);
    return () => window.clearInterval(timer);
  }, [reloadTasks]);

  const rooms = useMemo(
    () => new Map((census.state.status === "success" ? census.state.data : []).map((resident) => [resident.id, resident.room] as const)),
    [census.state],
  );
  const groups = useMemo(() => {
    if (tasks.state.status !== "success" || !now) return null;
    const window = floorShiftWindow(facility, now);
    const rows = tasks.state.data.filter((row) => !outbox.queuedTaskIdSet.has(row.id));
    return { window, ...groupRoundsQueue(rows, now, window.startIso, window.endIso) };
  }, [tasks.state, now, facility, outbox.queuedTaskIdSet]);

  const total = groups ? groups.over.length + groups.due.length + groups.upcoming.length + groups.done.length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6 pl-6 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 pr-4">
        <h1 className="text-[22px] font-semibold text-foreground">Rounds</h1>
        {groups ? (
          <p className="text-xs font-medium tabular-nums text-muted-foreground">
            {groups.window.label ? `${groups.window.label} shift` : "Last 12 hours"}
            {outbox.pendingCount > 0 ? ` · ${outbox.pendingCount} waiting to send` : ""}
          </p>
        ) : null}
      </div>
      {tasks.state.status === "error" ? (
        <FloorStatePanel state="error" title="The checks could not load." detail="Check the Wi-Fi, then try again." onRetry={reloadTasks} />
      ) : !groups ? (
        <FloorStatePanel state="loading" title="Loading this shift's checks" />
      ) : total === 0 ? (
        <FloorStatePanel state="empty" title="No checks are set for this shift." detail="Checks show here once the rounding schedule makes them." />
      ) : (
        <>
          <Group title="Over" checks={groups.over} rooms={rooms} timeZone={timeZone} />
          <Group title="Due now" checks={groups.due} rooms={rooms} timeZone={timeZone} />
          <Group title="Coming up" checks={groups.upcoming} rooms={rooms} timeZone={timeZone} />
          <Group title="Charted" checks={groups.done} rooms={rooms} timeZone={timeZone} />
        </>
      )}
      {groups && groups.olderOpen > 0 ? (
        <p className="mt-4 pr-4 text-[13px] text-muted-foreground">
          {groups.olderOpen} open {groups.olderOpen === 1 ? "check is" : "checks are"} from before this shift. The administrator reconciles those on the rounding board.
        </p>
      ) : null}
    </div>
  );
}
