"use client";

import { Repeat, Wifi, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";

import { FloorAvatar } from "./FloorAvatar";
import { FloorClock } from "./FloorClock";
import { FLOOR_OUTLINE_BUTTON } from "./floor-styles";
import { syncStateLabel, type FloorSyncState } from "./useFloorSyncState";

/**
 * The 56 px top bar on every unlocked screen (DESIGN.md 03 to 07b): who is
 * signed in and since when, the facility and tablet, sync state, the time, and
 * Switch, which locks the tablet for the next person.
 */
export function FloorTopBar({
  initials,
  displayName,
  detailLine,
  facilityName,
  deviceLabel,
  sync,
  timeZone,
  onSwitch,
}: {
  initials: string;
  displayName: string;
  /** "Med tech · Day shift · on since 6:58 AM". */
  detailLine: string;
  facilityName: string | null;
  deviceLabel: string | null;
  sync: FloorSyncState;
  timeZone: string;
  onSwitch: () => void;
}) {
  const SyncIcon = sync.kind === "offline" ? WifiOff : Wifi;
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-chrome-primary px-5 text-chrome-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <FloorAvatar initials={initials} size="sm" filled />
        <div className="flex min-w-0 flex-col gap-px">
          <span className="text-[15px] font-semibold leading-tight">{displayName}</span>
          <span className="truncate text-xs leading-tight tabular-nums text-chrome-foreground-muted">{detailLine}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4.5">
        <span className="hidden text-xs font-medium tracking-wide text-chrome-foreground-muted lg:inline">
          {[facilityName, deviceLabel].filter(Boolean).join(" · ")}
        </span>
        <span
          role="status"
          className={cn("flex items-center gap-1.5 text-xs", sync.kind === "synced" ? "text-chrome-foreground-muted" : "text-floor-warning-text")}
        >
          <SyncIcon className="size-4" aria-hidden />
          {syncStateLabel(sync)}
        </span>
        <FloorClock timeZone={timeZone} className="text-chrome-foreground" />
        <button type="button" onClick={onSwitch} className={cn(FLOOR_OUTLINE_BUTTON, "h-11 px-4 text-sm font-medium text-chrome-foreground")}>
          <Repeat className="size-4" aria-hidden />
          Switch
        </button>
      </div>
    </header>
  );
}
