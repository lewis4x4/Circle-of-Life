"use client";

import { Frown, House, MapPin, Pill, SquarePlus, Thermometer, TrendingDown, Users, type LucideIcon } from "lucide-react";

import type { CareEventKind } from "@/lib/care-events/level-engine";
import { cn } from "@/lib/utils";

import { FLOOR_FOCUS_RING, FLOOR_PRESS } from "./floor-styles";

/** DESIGN.md §4 icon map for the eight tiles in `tiles.ts`. */
export const EVENT_TILE_ICONS: Record<CareEventKind, LucideIcon> = {
  fall: TrendingDown,
  injury_found: SquarePlus,
  condition_change: Thermometer,
  behavior: Frown,
  wandering: MapPin,
  medication: Pill,
  family_complaint: Users,
  environment: House,
};

/** One "What happened" tile (DESIGN.md 06): 150 px, event-colored icon, the tile word. */
export function EventTile({
  kind,
  word,
  description,
  disabled,
  onPick,
}: {
  kind: CareEventKind;
  word: string;
  description: string;
  disabled?: boolean;
  onPick: () => void;
}) {
  const Icon = EVENT_TILE_ICONS[kind];
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      title={description}
      className={cn(
        "flex h-37.5 w-full flex-col items-start justify-between rounded-[12px] border border-input bg-card p-4.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
        FLOOR_PRESS,
        FLOOR_FOCUS_RING,
      )}
    >
      <Icon className="size-7.5 text-floor-event" aria-hidden />
      <span className="text-[19px] font-semibold leading-tight text-foreground">{word}</span>
    </button>
  );
}
