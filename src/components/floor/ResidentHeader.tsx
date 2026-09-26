"use client";

import Link from "next/link";
import { Check, TriangleAlert } from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import { RESIDENT_FLAG_TONE, RESIDENT_FLAG_WORD, type ResidentFlag } from "@/lib/floor/now-rows";
import { cn } from "@/lib/utils";

import { FloorBackButton } from "./FloorScreenHeader";
import { FLOOR_FOCUS_RING, FLOOR_PRESS, FLOOR_PRIMARY_BUTTON } from "./floor-styles";

/**
 * The resident screen's header (DESIGN.md 04): back, name with the status pill,
 * "Rm 101 · reason", and the two actions: Something happened (outlined in the
 * event color) and Chart the next check (primary).
 */
export function ResidentHeader({
  residentId,
  name,
  flag,
  room,
  reason,
  nextCheck,
  nextOpening,
}: {
  residentId: string;
  name: string;
  /** Null while the status is unknown; stable shows no pill. */
  flag: ResidentFlag | null;
  room: string | null;
  reason: string | null;
  nextCheck: { taskId: string; timeLabel: string } | null;
  /** With nothing to chart now: when the next check opens. A check cannot be charted before its window opens. */
  nextOpening?: { opensLabel: string } | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <FloorBackButton back={{ href: "/floor/residents", label: "Back to residents" }} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-semibold text-foreground">{name}</h1>
            {flag && flag !== "stable" ? (
              <StatusPill tone={RESIDENT_FLAG_TONE[flag]} className="h-6 rounded-[5px] px-2.5 text-xs">
                {RESIDENT_FLAG_WORD[flag]}
              </StatusPill>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="tabular-nums">{room ? `Rm ${room}` : "No room posted"}</span>
            {reason ? ` · ${reason}` : null}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Link
          href={`/floor/report?resident=${encodeURIComponent(residentId)}`}
          className={cn(
            "inline-flex h-13 items-center gap-2 rounded-[10px] border border-floor-event px-4.5 text-[15px] font-semibold text-foreground hover:bg-muted",
            FLOOR_PRESS,
            FLOOR_FOCUS_RING,
          )}
        >
          <TriangleAlert className="size-4.5 text-floor-event" aria-hidden />
          Something happened
        </Link>
        {nextCheck ? (
          <Link href={`/floor/check/${nextCheck.taskId}`} className={cn(FLOOR_PRIMARY_BUTTON, "h-13 rounded-[10px] px-5 text-[15px]")}>
            <Check className="size-4.5" aria-hidden />
            Chart {nextCheck.timeLabel} check
          </Link>
        ) : nextOpening ? (
          <p className="inline-flex h-13 items-center rounded-[10px] border border-border px-5 text-[15px] text-muted-foreground">
            Next check opens at {nextOpening.opensLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}
