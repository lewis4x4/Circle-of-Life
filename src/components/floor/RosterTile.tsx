"use client";

import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

import { FloorAvatar } from "./FloorAvatar";
import { FLOOR_FOCUS_RING, FLOOR_PRESS } from "./floor-styles";

/**
 * One person on shift on the lock screen (DESIGN.md 01): a 300 x 220 tile with
 * initials, name, "Med tech · In 6:58 AM". The last person on this tablet gets
 * the primary edge and the "Last on this tablet" line; anyone with items still
 * waiting to send gets the "n unsent" pill.
 */
export function RosterTile({
  displayName,
  initials,
  roleLabel,
  clockedInLabel,
  lastOnThisTablet,
  unsent,
  onSelect,
}: {
  displayName: string;
  initials: string;
  roleLabel: string;
  /** "6:58 AM", or null when no punch time came back. */
  clockedInLabel: string | null;
  lastOnThisTablet: boolean;
  unsent: number;
  onSelect: () => void;
}) {
  const subLine = [roleLabel, clockedInLabel ? `In ${clockedInLabel}` : null].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      data-testid="roster-tile"
      onClick={onSelect}
      aria-label={`${displayName}, ${roleLabel}${unsent > 0 ? `, ${unsent} unsent` : ""}`}
      className={cn(
        "relative flex h-55 w-75 max-w-full flex-col items-center justify-center gap-4 rounded-[14px] border bg-card hover:bg-muted",
        lastOnThisTablet ? "border-primary" : "border-border",
        FLOOR_PRESS,
        FLOOR_FOCUS_RING,
      )}
    >
      {lastOnThisTablet && unsent === 0 ? (
        <span className="absolute right-3.5 top-3.5 text-xs font-medium text-primary">Last on this tablet</span>
      ) : null}
      {unsent > 0 ? (
        <span className="absolute right-3.5 top-3.5 flex flex-col items-end gap-1">
          <StatusPill tone="warning" className="h-6 rounded-[5px] px-2.5 text-xs">
            {`${unsent} unsent`}
          </StatusPill>
          {lastOnThisTablet ? <span className="text-xs font-medium text-primary">Last on this tablet</span> : null}
        </span>
      ) : null}
      <FloorAvatar initials={initials} size="md" />
      <span className="flex flex-col items-center gap-1 px-4">
        <span className="text-2xl font-semibold text-foreground">{displayName}</span>
        <span className="text-sm tabular-nums text-muted-foreground">{subLine}</span>
      </span>
    </button>
  );
}
