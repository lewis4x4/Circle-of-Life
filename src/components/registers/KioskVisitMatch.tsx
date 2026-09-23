"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";

import type { VisitableResident } from "./VisitorLogClient";

/**
 * "Match resident" for a kiosk entry (COL-692): the visitor typed a name at the
 * door; the desk picks the resident it means from the same list the desk's
 * own sign-in form uses. The match is written once, by visitor_match_resident.
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
  const [residentId, setResidentId] = useState("");
  const id = useId();

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Match resident
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Resident {typedName} is visiting
      </label>
      <select
        id={id}
        value={residentId}
        onChange={(event) => setResidentId(event.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      >
        <option value="">Choose a resident…</option>
        {residents.map((resident) => (
          <option key={resident.id} value={resident.id}>
            {resident.lastName}, {resident.firstName}
          </option>
        ))}
      </select>
      <Button type="button" size="sm" disabled={!residentId || busy} onClick={() => onMatch(residentId)}>
        Match
      </Button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground underline">
        Cancel
      </button>
    </div>
  );
}
