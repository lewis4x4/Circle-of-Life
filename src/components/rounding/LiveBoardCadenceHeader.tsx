"use client";

/**
 * The read-only cadence header on the Live board. Spec 25A section 6.13.
 *
 * "A read-only view of the current cadence renders on the Smart Rounding Live
 * board header so a caregiver can see the times in force without leaving the
 * board." Editing lives in facility administration, which is where section
 * 6.13 puts it, and is not reachable from here.
 *
 * Every time on screen comes from a row. The windows arrive from
 * `facility_observation_windows_for_date`, which resolves the cadence version
 * in force for the service date and projects its enabled windows; the shifts
 * arrive from `facility_shift_definitions`. There is no list of times in this
 * file and no list of shifts, which is also why the retired third daypart
 * cannot appear on it.
 *
 * What it replaces said "Discovery cadence not configured" whenever a facility
 * name did not match a hardcoded list, and named the person whose cadence it
 * was. Both are gone: the cadence is configuration, it is in force at every
 * building, and it belongs to the building.
 */

import { Clock } from "lucide-react";

import { formatLiveRoundingTimeOfDay } from "@/lib/rounding/live-rounding-display-copy";
import type { LiveBoardShiftRow, LiveBoardWindowRow } from "@/lib/rounding/live-board-fetch";

/** A shift boundary as the row stores it, read as an operator says it. */
function localTimeLabel(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "No time posted";
  const parts = trimmed.split(":");
  const hours = Number.parseInt(parts[0] ?? "", 10);
  const minutes = Number.parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return "No time posted";
  const suffix = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function LiveBoardCadenceHeader({
  windows,
  shifts,
  unavailable,
}: {
  windows: readonly LiveBoardWindowRow[];
  shifts: readonly LiveBoardShiftRow[];
  /** True when the cadence read itself failed, which is not the same as none. */
  unavailable?: boolean;
}) {
  if (unavailable) {
    return (
      <section
        aria-label="Cadence in force"
        className="rounded-lg border border-border bg-card px-4 py-3"
      >
        <p className="text-[13px] font-medium text-foreground">
          The cadence in force could not be read.
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The board below still shows the checks that were generated from it.
        </p>
      </section>
    );
  }

  if (windows.length === 0) {
    return (
      <section
        aria-label="Cadence in force"
        className="rounded-lg border border-border bg-card px-4 py-3"
      >
        <p className="text-[13px] font-medium text-foreground">
          No observation windows in force for today.
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The building&apos;s cadence sets the windows. An administrator can review it in facility
          administration.
        </p>
      </section>
    );
  }

  // Shift order comes from the shift rows' own sort order. Windows whose shift
  // has no row are listed last rather than dropped, because a window nobody
  // owns is the finding, not a rendering problem.
  const groups = shifts.map((shift) => ({
    key: shift.shift_key,
    label: shift.label,
    span: `${localTimeLabel(shift.starts_at_local)} to ${localTimeLabel(shift.ends_at_local)}`,
    windows: windows.filter((window) => window.shift_key === shift.shift_key),
  }));
  const shiftKeys = new Set(shifts.map((shift) => shift.shift_key));
  const orphaned = windows.filter((window) => !shiftKeys.has(window.shift_key));

  return (
    <section
      aria-label="Cadence in force"
      className="rounded-lg border border-border bg-card px-4 py-4"
    >
      <div className="flex items-center gap-2">
        <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-[13px] font-semibold text-foreground">Cadence in force today</h2>
        <span className="text-[12px] text-muted-foreground">
          {windows.length} {windows.length === 1 ? "check" : "checks"} per resident
        </span>
      </div>

      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.key} className="min-w-0">
            <dt className="text-[12px] font-medium text-foreground">
              {group.label} shift
              <span className="ml-1.5 font-normal text-muted-foreground">{group.span}</span>
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {group.windows.length === 0 ? (
                <span className="text-[12px] text-muted-foreground">
                  No windows on this shift.
                </span>
              ) : (
                group.windows.map((window) => (
                  <span
                    key={window.window_key}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[12px] text-foreground"
                  >
                    <span className="font-medium tabular-nums">
                      {formatLiveRoundingTimeOfDay(window.due_at_utc)}
                    </span>
                    <span className="text-muted-foreground">{window.label}</span>
                  </span>
                ))
              )}
            </dd>
          </div>
        ))}
      </dl>

      {orphaned.length > 0 ? (
        <p className="mt-3 text-[12px] text-warning">
          {orphaned.length} {orphaned.length === 1 ? "window is" : "windows are"} set to a shift this
          building does not run. An administrator needs to reassign{" "}
          {orphaned.length === 1 ? "it" : "them"} in facility administration.
        </p>
      ) : null}

      <p className="mt-3 text-[12px] text-muted-foreground">
        Times are the building&apos;s, in Eastern. Editing the cadence happens in facility
        administration.
      </p>
    </section>
  );
}
