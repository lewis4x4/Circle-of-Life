"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  VISITOR_LOG_EMPTY_COPY,
  needsResidentMatch,
  visitingDisplay,
  visitorDisplayName,
  visitorTypeLabel,
  type VisitorLogRow,
} from "@/lib/registers/visitor-log";
import { formatElapsedSince, formatRegisterEventDate, formatRegisterEventTime } from "@/lib/registers/register-display-copy";

import { KioskVisitMatch } from "./KioskVisitMatch";
import type { VisitableResident } from "./VisitorLogClient";

/** Tier 1: who is in the building right now, with sign out and (kiosk entries) Match resident. */
export function VisitorsInBuilding({
  openNow,
  loading,
  busyId,
  residents,
  onSignOutAll,
  onSignOut,
  onMatch,
}: {
  openNow: VisitorLogRow[];
  loading: boolean;
  busyId: string | null;
  residents: VisitableResident[];
  onSignOutAll: () => void;
  onSignOut: (entryId: string) => void;
  onMatch: (entryId: string, residentId: string) => void;
}) {
  return (
    <section aria-labelledby="visitor-now-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="visitor-now-heading" className="text-sm font-medium text-foreground">
          In the building now ({openNow.length})
        </h2>
        {openNow.length > 0 ? (
          <Button type="button" variant="outline" size="sm" disabled={busyId === "all"} onClick={onSignOutAll}>
            Sign out everyone still here
          </Button>
        ) : null}
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      ) : openNow.length === 0 ? (
        <p className="text-sm text-muted-foreground">{VISITOR_LOG_EMPTY_COPY}</p>
      ) : (
        <ul className="space-y-2">
          {openNow.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 rounded-[9px] border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{visitorDisplayName(row)}</p>
                <p className="text-xs text-muted-foreground">
                  {visitorTypeLabel(row.visitorType)}
                  {visitingDisplay(row) ? ` · visiting ${visitingDisplay(row)}` : null}
                  {" · in "}
                  {formatRegisterEventTime(row.signedInAt)}
                  {" · "}
                  {formatElapsedSince(row.signedInAt)}
                </p>
                {row.leftOpen ? (
                  <p className="text-xs text-muted-foreground">
                    Still signed in from {formatRegisterEventDate(row.signedInAt)}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {needsResidentMatch(row) ? (
                  <KioskVisitMatch
                    typedName={row.visitingNameText ?? ""}
                    residents={residents}
                    busy={busyId === row.id}
                    onMatch={(residentId) => onMatch(row.id, residentId)}
                  />
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() => onSignOut(row.id)}
                >
                  Sign out
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
