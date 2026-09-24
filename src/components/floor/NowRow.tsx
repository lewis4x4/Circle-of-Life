"use client";

import Link from "next/link";
import { Check } from "lucide-react";

import { StatusPill, type StatusPillTone } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

import { FLOOR_OUTLINE_BUTTON, FLOOR_PRIMARY_BUTTON } from "./floor-styles";

const BAR_CLASS = { destructive: "bg-destructive", warning: "bg-warning", none: "bg-transparent" } as const;

export type NowRowProps = {
  /** Room number, or a place such as "Hall B". */
  place: string;
  title: string;
  subtitle: string;
  dueLabel: string;
  pill: { label: string; tone: StatusPillTone };
  bar: keyof typeof BAR_CLASS;
  /** Filled when the item needs doing now, outlined otherwise. */
  primaryAction: boolean;
  /** A link to chart the check, or a handler for a task; neither for a charted row. */
  doneHref?: string;
  onDone?: () => void;
  doneExpanded?: boolean;
  /** Accessible name; starts with the visible "Done" (WCAG 2.5.3 label in name). */
  doneLabel?: string;
};

/**
 * One row of the Now list (DESIGN.md 03): 64 px, 3 px status bar, room, who
 * and what, due time, a value-derived pill and one Done action.
 */
export function NowRow({ place, title, subtitle, dueLabel, pill, bar, primaryAction, doneHref, onDone, doneExpanded, doneLabel }: NowRowProps) {
  const actionClass = cn(primaryAction ? FLOOR_PRIMARY_BUTTON : cn(FLOOR_OUTLINE_BUTTON, "font-semibold"), "h-12 w-27 shrink-0 text-[15px]");
  const accessibleName = doneLabel ?? `Done: ${title}, ${subtitle}`;
  const content = (
    <>
      <Check className="size-4" aria-hidden />
      Done
    </>
  );
  return (
    <div data-testid="now-row" className="flex min-h-16 items-center gap-4 border-b border-border py-1.5 pr-4">
      <span aria-hidden className={cn("h-10 w-0.75 shrink-0 rounded-sm", BAR_CLASS[bar])} />
      <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">{place}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words text-[17px] font-semibold text-foreground">{title}</span>
        <span className="text-[13px] text-muted-foreground">{subtitle}</span>
      </span>
      <span className="w-21 shrink-0 text-right text-sm tabular-nums text-foreground">{dueLabel}</span>
      <span className="flex w-29 shrink-0 justify-end">
        <StatusPill tone={pill.tone} className="h-6 rounded-[5px] px-2.5 text-xs tabular-nums">
          {pill.label}
        </StatusPill>
      </span>
      {!doneHref && !onDone ? (
        <span className="w-27 shrink-0" aria-hidden />
      ) : doneHref ? (
        <Link href={doneHref} aria-label={accessibleName} className={actionClass}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={onDone} aria-label={accessibleName} aria-expanded={doneExpanded} className={actionClass}>
          {content}
        </button>
      )}
    </div>
  );
}
