"use client";

import { useMemo, useState } from "react";

import { useCareEventReport } from "@/components/care-events/useCareEventReport";
import type { CareEventKind } from "@/lib/care-events/level-engine";
import type { ReportResident } from "@/lib/care-events/report-state";
import { careEventTileWord } from "@/lib/care-events/tiles";
import { CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY } from "@/lib/caregiver/facility-residents-display-copy";
import { fetchFloorCensus, fetchFloorTasks } from "@/lib/floor/floor-data";
import { selectNowChecks } from "@/lib/floor/now-rows";
import {
  answerSummary,
  floorReportView,
  previousQuestionIndex,
  questionCounterLabel,
  reportProgressPercent,
} from "@/lib/floor/report-adapter";
import { floorShiftWindow } from "@/lib/floor/shift-window";
import { formatDisplayTime } from "@/lib/format/datetime";

import { useFloorSession } from "./FloorContext";
import { FloorReportPick, WHO_CHIP_LIMIT } from "./FloorReportPick";
import { FloorReportQuestion, FloorReportSend } from "./FloorReportQuestion";
import { FloorReportSent } from "./FloorReportSent";
import { FloorScreenHeader } from "./FloorScreenHeader";
import { FloorStatePanel } from "./FloorStatePanel";
import { useFloorQuery } from "./useFloorQuery";

/** People to offer first: my residents today, then whoever is due on Now. */
function suggestedResidents(input: { mine: readonly ReportResident[]; everyone: readonly ReportResident[]; dueResidentIds: readonly string[] }): ReportResident[] {
  const byId = new Map(input.everyone.map((resident) => [resident.id, resident] as const));
  const out: ReportResident[] = [];
  const seen = new Set<string>();
  const add = (resident: ReportResident | undefined) => {
    if (!resident || seen.has(resident.id) || out.length >= WHO_CHIP_LIMIT) return;
    seen.add(resident.id);
    out.push(resident);
  };
  input.mine.forEach(add);
  input.dueResidentIds.forEach((id) => add(byId.get(id)));
  return out;
}

/**
 * `/floor/report` (spec 40 §6 screen 6, DESIGN.md 06 to 07b): the caregiver
 * "Something happened" flow (same reducer, level engine and send path) laid
 * out for the tablet: who and what, one question per screen, send, receipt.
 */
export function FloorReportScreen({ prefillResidentId, prefillKind, onStartOver }: {
  prefillResidentId: string | null;
  prefillKind: CareEventKind | null;
  onStartOver: () => void;
}) {
  const { supabase, profile, facility, timeZone } = useFloorSession();
  const { data, ready, retry, state, dispatch, derivation, handleSend } = useCareEventReport({ prefillResidentId, prefillKind });
  const [questionIndex, setQuestionIndex] = useState(0);
  const [startedAt] = useState(() => new Date());

  // Who is due on Now; the same read and cache the Now screen uses.
  const tasks = useFloorQuery(`tasks:${facility.facilityId}`, () => fetchFloorTasks({ facilityId: facility.facilityId }), 60_000);
  const taskRows = tasks.state.status === "success" ? tasks.state.data : null;
  // Rooms read the floor's way (bed only in a shared room); the flow's own label is the fallback.
  const census = useFloorQuery(`census:${facility.facilityId}`, () => fetchFloorCensus(supabase, facility.facilityId), 5 * 60_000);
  const roomById = useMemo(
    () => new Map((census.state.status === "success" ? census.state.data : []).map((row) => [row.id, row.room] as const)),
    [census.state],
  );
  const withFloorRoom = useMemo(
    () => (resident: ReportResident): ReportResident => ({ ...resident, roomLabel: roomById.get(resident.id) ?? resident.roomLabel }),
    [roomById],
  );
  const everyone = useMemo(() => (ready ? ready.everyone.map(withFloorRoom) : []), [ready, withFloorRoom]);
  const suggested = useMemo(() => {
    if (!ready) return [];
    const due = selectNowChecks(taskRows ?? [], startedAt, floorShiftWindow(facility, startedAt).startIso);
    return suggestedResidents({
      mine: ready.myResidents.map(withFloorRoom),
      everyone,
      dueResidentIds: due.map((check) => check.residentId).filter((id): id is string => Boolean(id)),
    });
  }, [ready, facility, startedAt, taskRows, everyone, withFloorRoom]);

  if (data.status === "loading") return <FloorStatePanel state="loading" title="Loading your residents" className="flex-1" />;
  if (data.status === "error" || !ready) {
    return <FloorStatePanel state="error" title={data.status === "error" ? data.message : "Something happened could not open."} onRetry={retry} className="flex-1" />;
  }

  const view = floorReportView(state, questionIndex);

  if (view.screen === "pick") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <FloorScreenHeader
          back={{ href: "/floor", label: "Back to Now" }}
          title="Something happened"
          subtitle="Pick who, then what. A few taps; details come after."
          titleSize="lg"
          bordered={false}
        />
        <FloorReportPick
          suggested={suggested}
          everyone={everyone}
          selected={state.resident ? withFloorRoom(state.resident) : null}
          noResident={state.whoAnswered && !state.resident}
          onPickResident={(resident) => dispatch({ type: "pick_resident", resident })}
          onNoResident={() => dispatch({ type: "no_resident" })}
          onPickKind={(kind) => {
            if (!state.resident && !state.whoAnswered) dispatch({ type: "no_resident" });
            dispatch({ type: "pick_kind", kind });
            setQuestionIndex(0);
          }}
        />
      </div>
    );
  }

  const who = state.resident ? withFloorRoom(state.resident) : null;
  const title = `${state.kind ? careEventTileWord(state.kind) : "Something happened"} · ${who ? who.displayName : "The building"}`;
  const reportedAt = formatDisplayTime(state.sentAtIso ?? startedAt, { timeZone });
  const back = () => {
    if (view.screen === "sent") return onStartOver();
    if (view.screen === "send") return setQuestionIndex(view.total - 1);
    const previous = previousQuestionIndex(view.screen === "question" ? view.index : 0);
    if (previous === "pick") dispatch({ type: "back" });
    else setQuestionIndex(previous);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FloorScreenHeader
        back={{ onClick: back, label: view.screen === "sent" ? "Start over" : "Back" }}
        title={title}
        subtitle={
          <>
            {who ? (
              <span className="tabular-nums">
                {who.roomLabel === CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY ? who.roomLabel : `Rm ${who.roomLabel}`} ·{" "}
              </span>
            ) : null}
            reported by {profile.displayName} at <span className="tabular-nums">{reportedAt}</span>
          </>
        }
        right={<span className="text-[13px] font-medium tabular-nums text-muted-foreground">{questionCounterLabel(view)}</span>}
      />
      <div className="h-1 shrink-0 bg-muted" role="progressbar" aria-label="Report progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={reportProgressPercent(view)}>
        <div className="h-1 bg-primary" style={{ width: `${reportProgressPercent(view)}%` }} />
      </div>
      {view.screen === "question" ? (
        <FloorReportQuestion
          key={view.question.key}
          question={view.question}
          value={state.answers[view.question.key]}
          onAnswer={(value) => {
            dispatch({ type: "set_answer", key: view.question.key, value });
            setQuestionIndex(view.index + 1);
          }}
          onToggle={(value) => dispatch({ type: "toggle_answer", key: view.question.key, value })}
          onNext={() => setQuestionIndex(view.index + 1)}
        />
      ) : view.screen === "send" && derivation ? (
        <FloorReportSend state={state} derivation={derivation} locationChips={ready.locationChips} dispatch={dispatch} onSend={() => void handleSend()} />
      ) : view.screen === "sent" ? (
        <FloorReportSent
          answers={answerSummary(state)}
          offline={state.submitStatus === "queued"}
          level={state.receipt?.level ?? derivation?.level ?? 1}
          onCallPhone={ready.onCallPhone}
          onStartOver={onStartOver}
        />
      ) : null}
    </div>
  );
}
