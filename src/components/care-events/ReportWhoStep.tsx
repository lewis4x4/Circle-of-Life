"use client";

import { useId, useMemo, useState } from "react";
import { Building2, Search } from "lucide-react";

import type { ReportResident } from "@/lib/care-events/report-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { TapButton } from "./TapButton";

function initials(resident: ReportResident): string {
  const first = resident.firstName?.trim().charAt(0) ?? "";
  const last = resident.lastName?.trim().charAt(0) ?? "";
  return `${first}${last}`.toUpperCase() || resident.displayName.charAt(0).toUpperCase() || "?";
}

function matches(resident: ReportResident, query: string): boolean {
  if (!query) return true;
  const haystack = `${resident.displayName} ${resident.roomLabel}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function ResidentButton({ resident, onPick }: { resident: ReportResident; onPick: (resident: ReportResident) => void }) {
  return (
    <TapButton className="justify-start gap-4" onClick={() => onPick(resident)}>
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-foreground"
      >
        {initials(resident)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{resident.displayName}</span>
        <span className="text-sm text-muted-foreground">{resident.roomLabel}</span>
      </span>
    </TapButton>
  );
}

/**
 * Tap 1: Who (spec 07A §2). "My residents" from today's shift assignment,
 * then everyone at the facility, an optional search filter, and the
 * "No resident, the building" door.
 */
export function ReportWhoStep({
  myResidents,
  everyone,
  loading,
  onPickResident,
  onNoResident,
}: {
  myResidents: ReportResident[];
  everyone: ReportResident[];
  loading: boolean;
  onPickResident: (resident: ReportResident) => void;
  onNoResident: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const trimmed = query.trim();
  const filteredMine = useMemo(() => myResidents.filter((r) => matches(r, trimmed)), [myResidents, trimmed]);
  const mineIds = useMemo(() => new Set(myResidents.map((r) => r.id)), [myResidents]);
  const filteredEveryone = useMemo(
    () => everyone.filter((r) => !mineIds.has(r.id) && matches(r, trimmed)),
    [everyone, mineIds, trimmed],
  );

  return (
    <section className="space-y-5" aria-labelledby="report-who-heading">
      <div>
        <h2 id="report-who-heading" className="text-2xl font-semibold text-foreground">
          Who is it about?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Tap a resident, or the building if no one in particular.</p>
      </div>

      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search residents by name or room
        </label>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={searchId}
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="Search by name or room (optional)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={cn(
            "min-h-14 w-full rounded-lg border border-border bg-card pl-12 pr-4 text-base text-foreground placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          )}
        />
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading residents">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <>
          {myResidents.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-foreground">My residents</h3>
              {filteredMine.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one on your assignment matches that search.</p>
              ) : (
                <ul className="space-y-2">
                  {filteredMine.map((resident) => (
                    <li key={resident.id}>
                      <ResidentButton resident={resident} onPick={onPickResident} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <div className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">Everyone</h3>
            {filteredEveryone.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {everyone.length === 0 ? "No active residents at this facility." : "No resident matches that search."}
              </p>
            ) : (
              <ul className="space-y-2">
                {filteredEveryone.map((resident) => (
                  <li key={resident.id}>
                    <ResidentButton resident={resident} onPick={onPickResident} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <TapButton className="justify-start gap-4" onClick={onNoResident}>
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          <Building2 className="size-5" />
        </span>
        <span className="font-semibold">No resident, the building</span>
      </TapButton>
    </section>
  );
}
