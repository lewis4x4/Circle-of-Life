"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { flagFor, type FloorResident, type ResidentStatusSignals } from "@/lib/floor/floor-data";
import { orderRailResidents, type ResidentFlag } from "@/lib/floor/now-rows";
import { formatDisplayTime } from "@/lib/format/datetime";
import { cn } from "@/lib/utils";

import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_FOCUS_RING, FLOOR_PRESS } from "./floor-styles";
import { ResidentRailTile } from "./ResidentRailTile";

export const RAIL_TILE_LIMIT = 8;

const HOLD_NOTE: Record<string, string> = { hospital_hold: "Bed hold, hospital", loa: "On leave" };

/** The tile's one note: why it is flagged, or the next check. */
export function railNote(
  resident: FloorResident,
  flag: ResidentFlag | null,
  signals: ResidentStatusSignals | null,
  nextDueAt: string | null,
  timeZone: string,
): string | null {
  if (flag === "alert") return signals?.escalations.get(resident.id)?.label ?? "Open escalation";
  if (flag === "watch") return signals?.watches.get(resident.id)?.label ?? "On watch";
  if (flag === "hold") return HOLD_NOTE[resident.status] ?? null;
  return nextDueAt ? `Next check ${formatDisplayTime(nextDueAt, { timeZone })}` : null;
}

/** "Something happened": the one event-colored action (DESIGN.md §3). */
export function SomethingHappenedButton({ href, className }: { href: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-16 items-center justify-center gap-2.5 rounded-[10px] bg-floor-event text-lg font-semibold text-floor-event-foreground hover:opacity-90",
        FLOOR_PRESS,
        FLOOR_FOCUS_RING,
        className,
      )}
    >
      <TriangleAlert className="size-5" aria-hidden />
      Something happened
    </Link>
  );
}

/**
 * The Now screen's residents rail (DESIGN.md 03): 360 px on the side in
 * landscape, full width under the list in portrait. Flagged residents first.
 */
export function FloorResidentsRail({
  census,
  censusState,
  signals,
  nextDueByResident,
  timeZone,
  onRetry,
}: {
  census: readonly FloorResident[];
  censusState: "loading" | "error" | "ready";
  signals: ResidentStatusSignals | null;
  nextDueByResident: ReadonlyMap<string, string>;
  timeZone: string;
  onRetry: () => void;
}) {
  const withFlags = census.map((resident) => ({
    ...resident,
    flag: flagFor(resident, signals),
    nextDueAt: nextDueByResident.get(resident.id) ?? null,
  }));
  const tiles = orderRailResidents(withFlags, RAIL_TILE_LIMIT);
  const inBuilding = census.filter((resident) => resident.status === "active").length;
  const watchCount = signals ? withFlags.filter((resident) => resident.flag === "watch").length : 0;
  const alertCount = signals ? withFlags.filter((resident) => resident.flag === "alert").length : 0;

  return (
    <aside
      aria-label="Residents"
      className="flex w-full shrink-0 flex-col border-t border-border bg-chrome-secondary lg:w-90 lg:border-l lg:border-t-0"
    >
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2.5 pt-4">
        <h2 className="text-base font-semibold text-foreground">
          Residents{" "}
          {censusState === "ready" ? <span className="font-normal tabular-nums text-muted-foreground">{inBuilding} in building</span> : null}
        </h2>
        {censusState === "ready" && signals ? (
          <p className="flex gap-2.5 text-xs font-medium tabular-nums">
            {watchCount > 0 ? <span className="text-warning">{watchCount} watch</span> : null}
            {alertCount > 0 ? <span className="text-destructive">{alertCount} alert</span> : null}
          </p>
        ) : null}
      </div>
      {censusState === "loading" ? (
        <FloorStatePanel state="loading" title="Loading residents" />
      ) : censusState === "error" ? (
        <FloorStatePanel state="error" title="The residents could not load." onRetry={onRetry} />
      ) : census.length === 0 ? (
        <FloorStatePanel state="empty" title="No residents are listed in this building." />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2 px-4" aria-label="Residents to know about">
            {tiles.map((resident) => (
              <li key={resident.id} className="min-w-0">
                <ResidentRailTile
                  href={`/floor/residents/${resident.id}`}
                  room={resident.room}
                  name={resident.name}
                  flag={signals ? resident.flag : resident.flag === "hold" ? "hold" : null}
                  note={railNote(resident, signals || resident.flag === "hold" ? resident.flag : null, signals, resident.nextDueAt, timeZone)}
                />
              </li>
            ))}
          </ul>
          <Link href="/floor/residents" className={cn("mx-4 mt-1 inline-flex min-h-11 w-fit items-center text-[13px] font-medium text-primary hover:underline", FLOOR_FOCUS_RING)}>
            All {census.length} residents
          </Link>
        </>
      )}
      <div className="min-h-4 flex-1" />
      <SomethingHappenedButton href="/floor/report" className="mx-4 mb-4" />
    </aside>
  );
}
