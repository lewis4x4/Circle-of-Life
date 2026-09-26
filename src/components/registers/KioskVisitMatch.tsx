"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { residentPrefixMatches } from "@/lib/registers/visitor-log";
import { cn } from "@/lib/utils";

import type { VisitableResident } from "./VisitorLogClient";

/**
 * "Match resident" for a kiosk entry (COL-692): the visitor typed a name at the
 * door; the desk finds the resident it means with the same type-ahead the
 * kiosk uses (first or last name, at most six), picks one, and confirms with
 * Match. The match is written once, by visitor_match_resident.
 */
export function KioskVisitMatch({
  typedName,
  residents,
  busy,
  onMatch,
}: {
  typedName: string;
  residents: VisitableResident[];
  busy: boolean;
  onMatch: (residentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<VisitableResident | null>(null);
  const id = useId();
  const listId = `${id}-list`;

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Match resident
      </Button>
    );
  }

  const close = () => {
    setOpen(false);
    setQuery("");
    setPicked(null);
  };

  if (picked) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {picked.firstName} {picked.lastName}
        </span>
        <Button type="button" size="sm" disabled={busy} onClick={() => onMatch(picked.id)}>
          Match
        </Button>
        <button type="button" onClick={() => setPicked(null)} className="text-xs text-muted-foreground underline">
          Change
        </button>
      </div>
    );
  }

  const matches = residentPrefixMatches(residents, query);
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-72">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Resident {typedName} is visiting
        </label>
        <input
          id={id}
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 60))}
          placeholder="Start typing their first or last name"
          autoComplete="off"
          autoFocus
          aria-controls={matches.length > 0 ? listId : undefined}
          aria-describedby={`${id}-status`}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <button type="button" onClick={close} className="text-xs text-muted-foreground underline">
          Cancel
        </button>
      </div>
      <p id={`${id}-status`} role="status" className="text-xs text-muted-foreground empty:hidden">
        {query.trim() && matches.length === 0 ? "No match. Check the spelling." : ""}
      </p>
      {matches.length > 0 ? (
        <ul id={listId} aria-label="Matching residents" className="overflow-hidden rounded-md border border-border bg-card">
          {matches.map((resident) => (
            <li key={resident.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => setPicked(resident)}
                className={cn("flex min-h-9 w-full items-center px-2 text-left text-xs text-foreground hover:bg-muted", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}
              >
                {resident.firstName} {resident.lastName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
