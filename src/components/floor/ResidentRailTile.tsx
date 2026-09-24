"use client";

import Link from "next/link";

import { RESIDENT_FLAG_WORD, type ResidentFlag } from "@/lib/floor/now-rows";
import { cn } from "@/lib/utils";

import { FLOOR_FOCUS_RING, FLOOR_PRESS } from "./floor-styles";

const DOT_CLASS: Record<ResidentFlag, string> = {
  alert: "bg-destructive",
  watch: "bg-warning",
  hold: "bg-info",
  stable: "bg-muted-foreground/70",
};

/**
 * A resident in the Now rail or the All residents list (DESIGN.md 03): room,
 * status dot, name, and one short note. The note carries the status in words
 * so the dot is never the only signal.
 */
export function ResidentRailTile({
  href,
  room,
  name,
  note,
  flag,
  className,
}: {
  href: string;
  room: string | null;
  name: string;
  note: string | null;
  /** Null when the status reads failed: no dot rather than a guessed one. */
  flag: ResidentFlag | null;
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-testid="resident-tile"
      className={cn(
        "flex min-h-19 min-w-0 flex-col gap-0.75 rounded-[10px] border border-border bg-card px-3 py-2.5 text-left hover:bg-muted",
        FLOOR_PRESS,
        FLOOR_FOCUS_RING,
        className,
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs leading-[15px] tabular-nums text-muted-foreground">{room ?? "No room posted"}</span>
        {flag ? (
          <span className="flex items-center">
            <span aria-hidden className={cn("size-2.25 rounded-full", DOT_CLASS[flag])} />
            <span className="sr-only">{RESIDENT_FLAG_WORD[flag]}</span>
          </span>
        ) : null}
      </span>
      <span className="break-words text-sm font-semibold leading-[18px] text-foreground">{name}</span>
      {note ? <span className="truncate text-xs leading-[15px] text-muted-foreground">{note}</span> : null}
    </Link>
  );
}
