"use client";

import { useState } from "react";

import { WitnessTaskCard } from "@/components/care-events/WitnessTaskCard";
import type { WitnessTask } from "@/lib/care-events/witness";
import { formatDisplayTime } from "@/lib/format/datetime";
import { FLOOR_CHECK_NAME, checkTiming, type CountSegment, type NowCheck } from "@/lib/floor/now-rows";
import { cn } from "@/lib/utils";

import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_SECTION_LABEL } from "./floor-styles";
import { NowRow } from "./NowRow";

const SEGMENT_CLASS: Record<CountSegment["tone"], string> = {
  destructive: "text-floor-destructive-text",
  warning: "text-floor-warning-text",
  muted: "text-muted-foreground",
};

/** A witness statement's timing from its due time alone; it has no server-derived band. */
function taskTiming(task: WitnessTask, now: Date) {
  return checkTiming(new Date(task.dueAt).getTime() < now.getTime() ? "overdue" : "upcoming", task.dueAt, now);
}

/**
 * The Now list column (DESIGN.md 03): title and counts, the facility's due and
 * over checks in time order, then this person's own tasks.
 */
export function FloorNowList({
  now,
  timeZone,
  checks,
  checksState,
  roomByResident,
  tasks,
  tasksState,
  counts,
  onRetryChecks,
  onTaskDone,
}: {
  now: Date;
  timeZone: string;
  checks: readonly NowCheck[];
  checksState: "loading" | "error" | "ready";
  roomByResident: ReadonlyMap<string, string | null>;
  tasks: readonly WitnessTask[];
  tasksState: "loading" | "error" | "ready";
  counts: readonly CountSegment[];
  onRetryChecks: () => void;
  onTaskDone: () => void;
}) {
  const [openTask, setOpenTask] = useState<string | null>(null);

  return (
    <section aria-labelledby="floor-now-title" className="flex min-w-0 flex-1 flex-col pl-6 pt-4 lg:overflow-y-auto">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pr-4">
        <h1 id="floor-now-title" className="text-[22px] font-semibold text-foreground">
          Now
        </h1>
        {checksState === "ready" && counts.length > 0 ? (
          <p className="text-xs font-medium tabular-nums text-muted-foreground">
            {counts.map((segment, index) => (
              <span key={segment.text}>
                {index > 0 ? <span aria-hidden> · </span> : null}
                <span className={SEGMENT_CLASS[segment.tone]}>{segment.text}</span>
              </span>
            ))}
          </p>
        ) : null}
      </div>

      <div className="border-t border-border">
        {checksState === "loading" ? (
          <FloorStatePanel state="loading" title="Loading the checks that are due" />
        ) : checksState === "error" ? (
          <FloorStatePanel state="error" title="The checks could not load." detail="Check the Wi-Fi, then try again." onRetry={onRetryChecks} />
        ) : checks.length === 0 ? (
          <FloorStatePanel
            state="empty"
            title="No checks are due right now."
            detail="A check shows here once it is due, and an hour ahead of time."
          />
        ) : (
          checks.map((check) => (
            <NowRow
              key={check.id}
              place={(check.residentId ? roomByResident.get(check.residentId) : null) ?? ""}
              title={check.residentName}
              subtitle={FLOOR_CHECK_NAME}
              dueLabel={formatDisplayTime(check.dueAt, { timeZone })}
              pill={{ label: check.timing.label, tone: check.timing.tone }}
              bar={check.timing.bar}
              primaryAction={check.timing.primaryAction}
              doneHref={`/floor/check/${check.id}`}
              doneLabel={`Chart ${FLOOR_CHECK_NAME.toLowerCase()} for ${check.residentName}`}
            />
          ))
        )}
      </div>

      <h2 className={cn(FLOOR_SECTION_LABEL, "mt-3.5")}>Tasks</h2>
      <div className="mt-1.5 border-t border-border pb-4">
        {tasksState === "loading" ? (
          <FloorStatePanel state="loading" title="Loading your tasks" />
        ) : tasksState === "error" ? (
          <FloorStatePanel state="error" title="Your tasks could not load." />
        ) : tasks.length === 0 ? (
          <FloorStatePanel state="empty" title="No tasks for you right now." detail="Witness statements you are asked for show here." />
        ) : (
          tasks.map((task) => {
            const timing = taskTiming(task, now);
            return (
              <div key={task.id}>
                <NowRow
                  place=""
                  title="Witness statement"
                  subtitle={task.incidentNumber ? `For ${task.incidentNumber}` : task.description}
                  dueLabel={formatDisplayTime(task.dueAt, { timeZone })}
                  pill={{ label: timing.label, tone: timing.tone }}
                  bar={timing.bar}
                  primaryAction={timing.primaryAction}
                  onDone={() => setOpenTask((current) => (current === task.id ? null : task.id))}
                  doneExpanded={openTask === task.id}
                  doneLabel={`Answer the witness statement${task.incidentNumber ? ` for ${task.incidentNumber}` : ""}`}
                />
                {openTask === task.id ? (
                  <div className="border-b border-border py-4 pr-4">
                    <WitnessTaskCard
                      task={task}
                      onCompleted={() => {
                        setOpenTask(null);
                        onTaskDone();
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
