"use client";

import Link from "next/link";

import { formatDisplayTime } from "@/lib/format/datetime";
import { cn } from "@/lib/utils";

import { FLOOR_FOCUS_RING } from "./floor-styles";
import type { ShiftStripItem } from "@/lib/floor/shift-strip";

/** "6:58" without the day half, the way the strip chips read (DESIGN.md 03). */
function chipTime(iso: string, timeZone: string): string {
  return formatDisplayTime(iso, { timeZone }).replace(/\s?[AP]M$/i, "");
}

/**
 * The 64 px "My shift" strip above the tabs: what this person did this shift,
 * and when the shift hands off. Scrolls sideways inside itself; the page never
 * does.
 */
export function MyShiftStrip({
  items,
  handoffAt,
  timeZone,
  state,
  onRetry,
}: {
  items: readonly ShiftStripItem[];
  /** When the shift in force ends, or null when the facility has no shift definitions. */
  handoffAt: string | null;
  timeZone: string;
  state: "loading" | "error" | "ready";
  onRetry: () => void;
}) {
  return (
    <section aria-label="My shift" className="flex h-16 shrink-0 items-center gap-2.5 border-t border-border bg-chrome-secondary pl-6">
      <h2 className="mr-1.5 shrink-0 text-xs font-semibold text-muted-foreground">My shift</h2>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto pr-3" tabIndex={0} aria-label="My shift so far">
        {state === "loading" ? (
          <span className="text-[13px] text-muted-foreground" role="status">Loading your shift</span>
        ) : state === "error" ? (
          <span role="alert" className="flex items-center gap-2.5 text-[13px] text-foreground">
            Your shift so far could not load.
            <button
              type="button"
              onClick={onRetry}
              className={cn("inline-flex h-11 items-center rounded-[8px] border border-input px-3 text-[13px] font-medium hover:bg-muted", FLOOR_FOCUS_RING)}
            >
              Try again
            </button>
          </span>
        ) : items.length === 0 ? (
          <span className="text-[13px] text-muted-foreground">Nothing charted or filed yet this shift.</span>
        ) : (
          items.map((item) => {
            const body = (
              <>
                {item.at ? <span className="text-xs tabular-nums text-muted-foreground">{chipTime(item.at, timeZone)}</span> : null}
                <span className="whitespace-nowrap text-[13px] text-foreground">{item.text}</span>
              </>
            );
            const chip = "flex h-11 shrink-0 items-center gap-2.5 rounded-[8px] border border-border bg-card px-3";
            return item.href ? (
              <Link key={item.key} href={item.href} className={cn(chip, "hover:bg-muted", FLOOR_FOCUS_RING)}>
                {body}
              </Link>
            ) : (
              <div key={item.key} className={chip}>
                {body}
              </div>
            );
          })
        )}
      </div>
      {handoffAt ? (
        <span className="shrink-0 pr-6 text-xs tabular-nums text-muted-foreground">Handoff {formatDisplayTime(handoffAt, { timeZone })}</span>
      ) : null}
    </section>
  );
}
