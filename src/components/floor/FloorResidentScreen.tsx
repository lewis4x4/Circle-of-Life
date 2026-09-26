"use client";

import { useMemo } from "react";
import Link from "next/link";

import { fetchFloorCensus, fetchFloorTasks, fetchResidentStatusSignals, flagFor } from "@/lib/floor/floor-data";
import { clockWithoutDayHalf, fetchResidentDetail, floorVisitorTypeWord, knowBeforeItems, nextOpenCheck, recentCheckItems, type InfoItem } from "@/lib/floor/resident-detail";
import { facilityDayStartIso, formatShortDate } from "@/lib/floor/shift-window";
import { formatDisplayTime } from "@/lib/format/datetime";
import { cn } from "@/lib/utils";

import { useFloorSession } from "./FloorContext";
import { useFloorNow } from "./FloorClock";
import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_OUTLINE_BUTTON } from "./floor-styles";
import { InfoCard } from "./InfoCard";
import { StatusReadError } from "./FloorResidentsRail";
import { ResidentHeader } from "./ResidentHeader";
import { useFloorQuery } from "./useFloorQuery";

type Ready = "loading" | "error" | "ready";
const stateOf = (status: string): Ready => (status === "success" ? "ready" : status === "error" ? "error" : "loading");

/**
 * `/floor/residents/[id]`, Tier 2 (spec 40 §6 screen 4, DESIGN.md 04): enough
 * to walk into the room: today's checks, watches and follow-ups, and the
 * instruction fields from the resident record. The full record is Tier 3.
 */
export function FloorResidentScreen({ residentId }: { residentId: string }) {
  const { supabase, facility, timeZone } = useFloorSession();
  const now = useFloorNow();
  const facilityId = facility.facilityId;
  const dayStart = useMemo(() => (now ? facilityDayStartIso(timeZone, now) : null), [timeZone, now]);
  // The last 24 hours, so the card never empties at midnight. Keyed to the hour so it does not refetch every tick.
  const hourKey = now ? Math.floor(now.getTime() / 3_600_000) : null;
  const since = useMemo(() => (hourKey === null ? null : new Date((hourKey - 24) * 3_600_000).toISOString()), [hourKey]);

  const census = useFloorQuery(`census:${facilityId}`, () => fetchFloorCensus(supabase, facilityId), 5 * 60_000);
  const signals = useFloorQuery(`signals:${facilityId}`, () => fetchResidentStatusSignals(supabase, facilityId), 60_000);
  const tasks = useFloorQuery(`tasks:resident:${residentId}`, () => fetchFloorTasks({ facilityId, residentId }), 20_000);
  const detail = useFloorQuery(
    since ? `resident:${residentId}:${since}` : null,
    () => fetchResidentDetail(supabase, { residentId, facilityId, sinceIso: since as string }),
    30_000,
  );

  const resident = census.state.status === "success" ? census.state.data.find((row) => row.id === residentId) ?? null : null;
  const signalData = signals.state.status === "success" ? signals.state.data : null;
  const detailData = detail.state.status === "success" ? detail.state.data : null;
  const taskRows = useMemo(() => (tasks.state.status === "success" ? tasks.state.data : []), [tasks.state]);

  if (census.state.status === "error") return <FloorStatePanel state="error" title="This resident could not load." onRetry={census.reload} pageTitle="Resident" className="flex-1" />;
  if (census.state.status !== "success" || !now || !dayStart) return <FloorStatePanel state="loading" title="Opening the resident" pageTitle="Resident" className="flex-1" />;
  if (!resident || (detail.state.status === "success" && detailData === null)) {
    return <FloorStatePanel state="empty" title="This resident is not listed in this building." detail="Go back to Residents and pick again." pageTitle="Resident" className="flex-1" />;
  }

  const flag = signalData || resident.status !== "active" ? flagFor(resident, signalData) : null;
  const watch = signalData?.watches.get(resident.id);
  const reason = watch
    ? `${watch.label}${watch.endsAt ? ` through ${formatShortDate(watch.endsAt, timeZone)}` : ""}`
    : resident.status === "hospital_hold"
      ? "Bed hold, hospital"
      : resident.status === "loa"
        ? "On leave"
        : null;
  const next = tasks.state.status === "success" ? nextOpenCheck(taskRows, now) : null;

  const followUps: InfoItem[] = detailData
    ? [
        ...detailData.visitorsHere.map((row) => ({
          key: `visitor-${row.id}`,
          title: `${row.name} is visiting now`,
          detail: `${floorVisitorTypeWord(row.type).replace(/^./, (c) => c.toUpperCase())} · since ${formatDisplayTime(row.since, { timeZone })}`,
        })),
        ...detailData.watches.map((row) => ({
          key: `watch-${row.id}`,
          title: row.label,
          detail: row.endsAt ? `Through ${formatShortDate(row.endsAt, timeZone)}` : `Since ${formatShortDate(row.startsAt, timeZone)}`,
        })),
        ...detailData.escalations.map((row) => ({
          key: `escalation-${row.id}`,
          title: row.label,
          detail: `Since ${formatDisplayTime(row.triggeredAt, { timeZone })}`,
        })),
        ...(detailData.lastHandoff
          ? [
              {
                key: `handoff-${detailData.lastHandoff.id}`,
                title: detailData.lastHandoff.note,
                detail: ["Last handoff note", detailData.lastHandoff.shift, detailData.lastHandoff.authorName, formatShortDate(detailData.lastHandoff.createdAt, timeZone)]
                  .filter(Boolean)
                  .join(" · "),
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4.5">
      <ResidentHeader
        residentId={resident.id}
        name={resident.name}
        flag={flag}
        room={resident.room}
        reason={reason}
        nextCheck={next ? { taskId: next.id, timeLabel: clockWithoutDayHalf(next.due_at, timeZone) } : null}
      />
      {signals.state.status === "error" ? <StatusReadError text="Watch and alert status could not load." onRetry={signals.reload} /> : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <InfoCard
          title="Recent checks"
          state={tasks.state.status === "error" || detail.state.status === "error" ? "error" : stateOf(detailData ? tasks.state.status : detail.state.status)}
          items={detailData ? recentCheckItems({ tasks: taskRows, logs: detailData.logsToday, dayStartIso: dayStart, now, timeZone }) : []}
          emptyText="No checks in the last 24 hours, and none set for today."
          onRetry={() => {
            tasks.reload();
            detail.reload();
          }}
        />
        <InfoCard title="Watch and follow-ups" state={stateOf(detail.state.status)} items={followUps} emptyText="No watch, follow-up, handoff note or visitor." onRetry={detail.reload} />
        <InfoCard
          title="Know before you go in"
          state={stateOf(detail.state.status)}
          items={detailData ? knowBeforeItems(detailData.record) : []}
          emptyText="Nothing special is on the record."
          onRetry={detail.reload}
        />
      </div>
      <Link href={`/floor/residents/${resident.id}/record`} className={cn(FLOOR_OUTLINE_BUTTON, "h-11 w-fit px-4 text-sm text-muted-foreground")}>
        Full record and history
      </Link>
    </div>
  );
}
