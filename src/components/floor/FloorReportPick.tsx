"use client";

import { useId, useMemo, useState } from "react";
import { Building2, Search } from "lucide-react";

import type { CareEventKind } from "@/lib/care-events/level-engine";
import type { ReportResident } from "@/lib/care-events/report-state";
import { CARE_EVENT_TILES } from "@/lib/care-events/tiles";
import { cn } from "@/lib/utils";

import { ChoiceChip } from "./ChoiceChip";
import { EventTile } from "./EventTile";
import { FLOOR_FOCUS_RING, FLOOR_PRESS, FLOOR_SECTION_LABEL } from "./floor-styles";

/** Up to four people to offer first: the one already picked, my residents, then who is due now. */
export const WHO_CHIP_LIMIT = 4;

function matches(resident: ReportResident, query: string): boolean {
  const haystack = `${resident.displayName} ${resident.roomLabel}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

/**
 * Who and What on one screen (DESIGN.md 06): resident chips with their room,
 * "Someone else" to search everyone (or the building), and the eight tiles.
 */
export function FloorReportPick({
  suggested,
  everyone,
  selected,
  noResident,
  onPickResident,
  onNoResident,
  onPickKind,
}: {
  suggested: readonly ReportResident[];
  everyone: readonly ReportResident[];
  selected: ReportResident | null;
  noResident: boolean;
  onPickResident: (resident: ReportResident) => void;
  onNoResident: () => void;
  onPickKind: (kind: CareEventKind) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const searchId = useId();
  const found = useMemo(() => (query.trim() ? everyone.filter((resident) => matches(resident, query.trim())).slice(0, 12) : []), [everyone, query]);
  const chips = selected && !suggested.some((resident) => resident.id === selected.id) ? [selected, ...suggested].slice(0, WHO_CHIP_LIMIT) : suggested;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4.5 overflow-y-auto px-6 pb-6">
      <section className="flex flex-col gap-2.5" aria-labelledby="floor-report-who">
        <h2 id="floor-report-who" className={FLOOR_SECTION_LABEL}>
          Who
        </h2>
        <div className="flex flex-wrap gap-2.5">
          {chips.map((resident) => (
            <ChoiceChip key={resident.id} pressed={selected?.id === resident.id} onPress={() => onPickResident(resident)} className="px-4">
              <span className="text-[13px] font-medium tabular-nums text-muted-foreground">{resident.roomLabel}</span>
              {resident.displayName}
            </ChoiceChip>
          ))}
          <button
            type="button"
            aria-expanded={searching}
            onClick={() => setSearching((open) => !open)}
            className={cn(
              "inline-flex h-13 items-center gap-2 rounded-[8px] border border-dashed border-input px-4 text-[15px] text-muted-foreground hover:bg-muted",
              FLOOR_PRESS,
              FLOOR_FOCUS_RING,
            )}
          >
            <Search className="size-4" aria-hidden />
            Someone else
          </button>
        </div>
        {searching ? (
          <div className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-card p-4">
            <label htmlFor={searchId} className="text-[15px] font-semibold">
              Find a resident by name or room
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              className={cn("h-13 rounded-[8px] border border-input bg-background px-3.5 text-base text-foreground", FLOOR_FOCUS_RING)}
            />
            <div className="flex flex-wrap gap-2.5">
              {found.map((resident) => (
                <ChoiceChip
                  key={resident.id}
                  pressed={selected?.id === resident.id}
                  onPress={() => {
                    onPickResident(resident);
                    setSearching(false);
                  }}
                >
                  <span className="text-[13px] font-medium tabular-nums text-muted-foreground">{resident.roomLabel}</span>
                  {resident.displayName}
                </ChoiceChip>
              ))}
              {query.trim() && found.length === 0 ? <p className="text-sm text-muted-foreground">No resident matches that.</p> : null}
              <ChoiceChip pressed={noResident} onPress={onNoResident}>
                <Building2 className="size-4" aria-hidden />
                No resident, the building
              </ChoiceChip>
            </div>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2.5" aria-labelledby="floor-report-what">
        <h2 id="floor-report-what" className={FLOOR_SECTION_LABEL}>
          What happened
        </h2>
        {!selected && !noResident ? (
          <p className="text-sm text-muted-foreground">Tap who first. Building or other works without a resident.</p>
        ) : null}
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {CARE_EVENT_TILES.map((tile) => (
            <li key={tile.kind}>
              <EventTile
                kind={tile.kind}
                word={tile.word}
                description={tile.description}
                disabled={!selected && !tile.residentOptional}
                onPick={() => onPickKind(tile.kind)}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
