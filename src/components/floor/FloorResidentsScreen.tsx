"use client";

import { useId, useMemo, useState } from "react";

import { fetchFloorCensus, fetchResidentStatusSignals, flagFor } from "@/lib/floor/floor-data";
import { cn } from "@/lib/utils";

import { useFloorSession } from "./FloorContext";
import { railNote } from "./FloorResidentsRail";
import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_FOCUS_RING } from "./floor-styles";
import { ResidentRailTile } from "./ResidentRailTile";
import { useFloorQuery } from "./useFloorQuery";

/**
 * `/floor/residents`: everyone in the building in room order, in the rail's
 * tile language, with a filter by name or room.
 */
export function FloorResidentsScreen() {
  const { supabase, facility, timeZone } = useFloorSession();
  const facilityId = facility.facilityId;
  const census = useFloorQuery(`census:${facilityId}`, () => fetchFloorCensus(supabase, facilityId), 5 * 60_000);
  const signals = useFloorQuery(`signals:${facilityId}`, () => fetchResidentStatusSignals(supabase, facilityId), 60_000);
  const [query, setQuery] = useState("");
  const searchId = useId();

  const residents = useMemo(() => (census.state.status === "success" ? census.state.data : []), [census.state]);
  const signalData = signals.state.status === "success" ? signals.state.data : null;
  const shown = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return residents;
    return residents.filter((resident) => terms.every((term) => `${resident.name} ${resident.room ?? ""}`.toLowerCase().includes(term)));
  }, [residents, query]);
  const inBuilding = residents.filter((resident) => resident.status === "active").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-6 pb-3 pt-4">
        <div className="flex flex-col gap-0.75">
          <h1 className="text-[26px] font-semibold text-foreground">Residents</h1>
          {census.state.status === "success" ? (
            <p className="text-sm tabular-nums text-muted-foreground">
              {inBuilding} in building, {residents.length} in all
            </p>
          ) : null}
        </div>
        <div className="flex w-full max-w-sm flex-col gap-1">
          <label htmlFor={searchId} className="text-xs font-semibold text-muted-foreground">
            Find by name or room
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            className={cn("h-12 rounded-[8px] border border-input bg-card px-3.5 text-base text-foreground", FLOOR_FOCUS_RING)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {census.state.status === "error" ? (
          <FloorStatePanel state="error" title="The residents could not load." onRetry={census.reload} />
        ) : census.state.status !== "success" ? (
          <FloorStatePanel state="loading" title="Loading residents" />
        ) : residents.length === 0 ? (
          <FloorStatePanel state="empty" title="No residents are listed in this building." />
        ) : shown.length === 0 ? (
          <FloorStatePanel state="empty" title="No resident matches that." />
        ) : (
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4" aria-label="All residents">
            {shown.map((resident) => {
              const flag = flagFor(resident, signalData);
              const known = signalData || flag === "hold" ? flag : null;
              return (
                <li key={resident.id} className="min-w-0">
                  <ResidentRailTile
                    href={`/floor/residents/${resident.id}`}
                    room={resident.room}
                    name={resident.name}
                    flag={known}
                    note={railNote(resident, known, signalData, null, timeZone)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
