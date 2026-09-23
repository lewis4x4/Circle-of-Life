"use client";

/**
 * The Smart Rounding Live board. Spec 25A section 8, defect 9.
 *
 * This is `/admin/rounding` itself. Overview folded into it, because a summary
 * of the board was not a second destination, and Escalations folded into it as
 * a filter, because an escalation is a state a check is in, not a place.
 *
 * Read `live-board-fetch.ts` for why the data arrives as five reads rather than
 * one wide embed, and `live-board-state.ts` for the derivation acceptance item
 * 12 asserts. What is worth saying here is what this board refuses to show: no
 * resident level number of any kind (decision D5), no shift name this file
 * chose (the shift model is `facility_shift_definitions` rows, which is why
 * the retired third daypart cannot appear), and no window time this file holds
 * (the cadence header reads the version in force).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RefreshCw, UserPlus } from "lucide-react";

import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { LiveBoardCadenceHeader } from "@/components/rounding/LiveBoardCadenceHeader";
import { LiveBoardSummary } from "@/components/rounding/LiveBoardSummary";
import { LiveBoardTaskRow } from "@/components/rounding/LiveBoardTaskRow";
import { QuickCheckDrawer, type QuickCheckTask } from "@/components/rounding/QuickCheckDrawer";
import { RoundingEmptyNotice, RoundingErrorNotice } from "@/components/rounding/RoundingNotices";
import { RoundingHubNav } from "@/app/(admin)/admin/rounding/rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { useLiveBoardData } from "@/hooks/useLiveBoardData";
import {
  liveBoardEmptyCopy,
  liveBoardFilterEmptyCopy,
  liveBoardRoomLabel,
  liveBoardSubtitle,
  type LiveBoardFilter,
} from "@/lib/rounding/live-board-display-copy";
import type { LiveBoardTaskRow as TaskRow } from "@/lib/rounding/live-board-fetch";
import {
  deriveLiveBoardCounts,
  deriveLiveBoardState,
  filterLiveBoardTasks,
  groupEscalationsByTask,
  indexLiveBoardRoster,
  LIVE_BOARD_NO_RESIDENT_COPY,
  scopeLiveBoardTasks,
} from "@/lib/rounding/live-board-state";
import { cn } from "@/lib/utils";

export function LiveBoard() {
  const { selectedFacilityId } = useFacilityStore();
  return <ScopedLiveBoard key={selectedFacilityId ?? "none"} />;
}

function ScopedLiveBoard() {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const data = useLiveBoardData(selectedFacilityId);
  // Escalations is a filter, not a destination, so the links that used to point
  // at the Escalations tab arrive here with the filter already chosen.
  const initialFilter = useSearchParams()?.get("filter");
  const [filter, setFilter] = useState<LiveBoardFilter>(
    initialFilter === "escalated" ? "escalated" : "all",
  );
  const [drawerTask, setDrawerTask] = useState<QuickCheckTask | null>(null);

  const facilityName =
    availableFacilities.find((facility) => facility.id === selectedFacilityId)?.name ?? null;

  const scopedTasks = useMemo(
    () => scopeLiveBoardTasks(data.tasks, selectedFacilityId),
    [data.tasks, selectedFacilityId],
  );
  const residentIndex = useMemo(() => indexLiveBoardRoster(data.roster), [data.roster]);
  const escalationsByTask = useMemo(
    () => groupEscalationsByTask(data.escalations),
    [data.escalations],
  );
  const escalatedTaskIds = useMemo(() => new Set(escalationsByTask.keys()), [escalationsByTask]);
  const counts = useMemo(
    () => deriveLiveBoardCounts(scopedTasks, escalatedTaskIds),
    [scopedTasks, escalatedTaskIds],
  );
  const visibleTasks = useMemo(
    () => filterLiveBoardTasks(scopedTasks, filter, escalatedTaskIds),
    [scopedTasks, filter, escalatedTaskIds],
  );

  const boardState = deriveLiveBoardState({
    loadState: data.loadState,
    hasFacility: Boolean(selectedFacilityId),
    totalTasks: scopedTasks.length,
    filteredTasks: visibleTasks.length,
    filterApplied: filter !== "all",
  });

  const emptyCopy =
    boardState === "empty_filtered"
      ? liveBoardFilterEmptyCopy(filter)
      : liveBoardEmptyCopy({
          hasFacility: Boolean(selectedFacilityId),
          rosterCount: data.roster.length,
          windowCount: data.windows.length,
        });

  function openCheck(task: TaskRow) {
    const resident = residentIndex.get(task.resident_id);
    setDrawerTask({
      id: task.id,
      organizationId: task.organization_id,
      facilityId: task.facility_id,
      residentName: resident?.name ?? LIVE_BOARD_NO_RESIDENT_COPY,
      roomLabel: resident ? liveBoardRoomLabel(resident.roomNumber) : null,
      dueAt: task.due_at,
      status: task.status,
    });
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Live rounding board"
        subtitle={liveBoardSubtitle(facilityName)}
        actions={
          <>
            <Link
              href="/caregiver/rounds"
              className={cn(buttonVariants({ variant: "outline", size: "default" }))}
            >
              <UserPlus className="size-4" aria-hidden />
              Caregiver view
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={data.reload}
              aria-label="Refresh the live board"
              title="Refresh"
              disabled={data.loadState === "loading"}
            >
              <RefreshCw
                className={cn("size-4", data.loadState === "loading" && "animate-spin")}
                aria-hidden
              />
            </Button>
          </>
        }
      />

      <RoundingHubNav />

      {boardState === "no_facility" ? (
        <FacilityGateNotice reason="Rounding checks are scheduled and recorded per building." />
      ) : (
        <>
          <LiveBoardCadenceHeader
            windows={data.windows}
            shifts={data.shifts}
            unavailable={data.cadenceUnavailable}
          />

          {data.errorMessage ? (
            <RoundingErrorNotice message={data.errorMessage} onRetry={data.reload} />
          ) : null}

          <LiveBoardSummary
            counts={counts}
            rosterCount={data.roster.length}
            loadState={data.loadState}
            filter={filter}
            onFilterChange={setFilter}
          />

          {boardState === "loading" ? (
            <RoundingEmptyNotice
              label="Loading the live board"
              copy={{
                why: "Loading the board.",
                guidance: "Today's checks are on their way.",
              }}
            />
          ) : boardState === "empty" || boardState === "empty_filtered" ? (
            <RoundingEmptyNotice label="No checks on the board" copy={emptyCopy} />
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Checks on the live board">
              {visibleTasks.map((task) => {
                const resident = residentIndex.get(task.resident_id);
                return (
                  <li key={task.id}>
                    <LiveBoardTaskRow
                      task={task}
                      residentName={resident?.name ?? LIVE_BOARD_NO_RESIDENT_COPY}
                      roomNumber={resident?.roomNumber ?? null}
                      shifts={data.shifts}
                      windows={data.windows}
                      escalations={escalationsByTask.get(task.id) ?? []}
                      onOpen={openCheck}
                      onEscalationHandled={data.reload}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <QuickCheckDrawer
        task={drawerTask}
        open={drawerTask !== null && drawerTask.facilityId === selectedFacilityId}
        onClose={() => {
          setDrawerTask(null);
          data.reload();
        }}
        onCompleted={data.markCompleted}
      />
    </div>
  );
}
