"use client";

import { useMemo, useState } from "react";

import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import {
  VISITOR_LOG_RANGE_EMPTY_COPY,
  VOID_REASONS,
  filterVisitsToResident,
  needsResidentMatch,
  visitorLogResidentOptions,
  visitorLogResidentEmptyCopy,
  signedInByDisplay,
  visitingDisplay,
  visitorDisplayName,
  visitorTypeLabel,
  type VisitorLogRow,
} from "@/lib/registers/visitor-log";
import { formatRegisterEventTime } from "@/lib/registers/register-display-copy";

import { KioskVisitMatch } from "./KioskVisitMatch";
import type { VisitableResident } from "./VisitorLogClient";
import { VISITOR_INPUT_CLASS } from "./VisitorSignInForm";

const inputCls = VISITOR_INPUT_CLASS;

/** Tier 2: the log for a date range, with Void (coded reason) and Match resident for visits already over. */
export function VisitorLogTable({
  rows,
  from,
  to,
  onFrom,
  onTo,
  busyId,
  residents,
  onVoid,
  onMatch,
}: {
  rows: VisitorLogRow[];
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  busyId: string | null;
  residents: VisitableResident[];
  onVoid: (entryId: string, reason: string) => void;
  onMatch: (entryId: string, residentId: string) => void;
}) {
  const [voidingId, setVoidingId] = useState<string | null>(null);
  // Kept here, not in the parent's load, so it survives a change of dates (COL-871).
  const [residentId, setResidentId] = useState("");
  const residentOptions = useMemo(() => visitorLogResidentOptions(residents, rows), [residents, rows]);
  const shown = filterVisitsToResident(rows.filter((row) => !row.voidedAt), residentId);
  const residentName = residentOptions.find((option) => option.id === residentId)?.name ?? "";
  return (
    <section aria-labelledby="visitor-range-heading" className="space-y-3">
      <h2 id="visitor-range-heading" className="text-sm font-medium text-foreground">
        Visitor log
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="visitor-from" className="text-xs text-muted-foreground">
            From
          </label>
          <input id="visitor-from" type="date" value={from} onChange={(e) => onFrom(e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="visitor-to" className="text-xs text-muted-foreground">
            To
          </label>
          <input id="visitor-to" type="date" value={to} onChange={(e) => onTo(e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="visitor-log-resident" className="text-xs text-muted-foreground">
            Visits to
          </label>
          <select id="visitor-log-resident" value={residentId} onChange={(e) => setResidentId(e.target.value)} className={inputCls}>
            <option value="">Everyone</option>
            {residentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {residentId ? visitorLogResidentEmptyCopy(residentName) : VISITOR_LOG_RANGE_EMPTY_COPY}
        </p>
      ) : (
        <HorizontalScroll label="Visitor log">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Visitors signed in for the chosen range</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">Visitor</th>
                <th scope="col" className="py-2 pr-3 font-medium">Type</th>
                <th scope="col" className="py-2 pr-3 font-medium">Visiting</th>
                <th scope="col" className="py-2 pr-3 font-medium">In</th>
                <th scope="col" className="py-2 pr-3 font-medium">Out</th>
                <th scope="col" className="py-2 pr-3 font-medium">By</th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  <span className="sr-only">Correction</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                  <tr key={row.id} className="border-b border-border align-top">
                    <td className="py-2 pr-3 text-foreground">{visitorDisplayName(row)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{visitorTypeLabel(row.visitorType)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      <div className="flex flex-col items-start gap-1">
                        {row.visitingResidentId && row.visitingResidentId !== residentId ? (
                          <button
                            type="button"
                            className="text-left underline decoration-dotted underline-offset-2 hover:text-foreground"
                            aria-label={`Show only visits to ${visitingDisplay(row)}`}
                            onClick={() => setResidentId(row.visitingResidentId ?? "")}
                          >
                            {visitingDisplay(row)}
                          </button>
                        ) : (
                          <span>{visitingDisplay(row)}</span>
                        )}
                        {/* Open entries are matched from "In the building now" above; this covers visits already over. */}
                        {needsResidentMatch(row) && row.signedOutAt ? (
                          <KioskVisitMatch
                            typedName={row.visitingNameText ?? ""}
                            residents={residents}
                            busy={busyId === row.id}
                            onMatch={(residentId) => onMatch(row.id, residentId)}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {formatRegisterEventTime(row.signedInAt)}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {row.signedOutAt ? formatRegisterEventTime(row.signedOutAt) : ""}
                      {row.signOutMethod === "bulk_end_of_day" ? " (end of day)" : ""}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{signedInByDisplay(row)}</td>
                    <td className="py-2 pr-3">
                      {voidingId === row.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor={`void-${row.id}`} className="sr-only">
                            Why is this entry wrong
                          </label>
                          <select
                            id={`void-${row.id}`}
                            defaultValue=""
                            onChange={(event) => {
                              const reason = event.target.value;
                              if (!reason) return;
                              setVoidingId(null);
                              onVoid(row.id, reason);
                            }}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                          >
                            <option value="">Why is it wrong…</option>
                            {VOID_REASONS.map((reason) => (
                              <option key={reason.id} value={reason.id}>
                                {reason.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setVoidingId(null)}
                            className="text-xs text-muted-foreground underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setVoidingId(row.id)}
                          className="text-xs text-muted-foreground underline"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </HorizontalScroll>
      )}
    </section>
  );
}
