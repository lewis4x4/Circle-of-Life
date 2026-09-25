"use client";

import { useEffect, useState } from "react";

import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { StatusPill } from "@/components/ui/status-pill";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";

import { IntakeRequestError, loadSummary, type IntakeSummary } from "./api";
import { ageLabel } from "./model";

/** Corporate view: per-facility counts, mailbox receipt health, stuck processing. */
export function OperationsStrip({ facilityNames, reloadKey }: { facilityNames: Record<string, string>; reloadKey: number }) {
  const [summary, setSummary] = useState<IntakeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadSummary(controller.signal)
      .then((data) => {
        setSummary(data);
        setError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (cause instanceof IntakeRequestError && (cause.status === 403 || cause.status === 401)) setHidden(true);
        else setError(cause instanceof Error ? cause.message : "Operations summary is unavailable.");
      });
    return () => controller.abort();
  }, [reloadKey]);

  if (hidden) return null;

  const stuck = summary?.stuck_runs ?? 0;

  return (
    <section aria-label="Intake operations" className="grid gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Operations</h2>
        {summary ? (
          <StatusPill tone={stuck > 0 ? "danger" : "muted"}>{stuck > 0 ? `${stuck} stuck ${stuck === 1 ? "run" : "runs"}` : "No stuck runs"}</StatusPill>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!summary && !error ? <p className="text-sm text-muted-foreground">Loading operations…</p> : null}
      {summary ? (
        <>
          <HorizontalScroll label="Documents waiting by facility">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Documents waiting by facility</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">Facility</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Pending</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Needs attention</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Processing</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Overdue</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Unassigned</th>
                  <th scope="col" className="py-1 font-medium">Oldest waiting</th>
                </tr>
              </thead>
              <tbody>
                {summary.facilities.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-2 text-muted-foreground">
                      Nothing is waiting.
                    </td>
                  </tr>
                ) : (
                  summary.facilities.map((f) => (
                    <tr key={f.facility_id ?? "unknown"} className="border-t border-border">
                      <th scope="row" className="py-1.5 pr-3 font-medium text-foreground">
                        {f.facility_id ? (facilityNames[f.facility_id] ?? "Facility") : "Facility unknown"}
                      </th>
                      <td className="py-1.5 pr-3 tabular-nums">{f.pending}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{f.needs_attention}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{f.processing}</td>
                      <td className={f.overdue > 0 ? "py-1.5 pr-3 font-semibold tabular-nums text-destructive" : "py-1.5 pr-3 tabular-nums"}>{f.overdue}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{f.unassigned}</td>
                      <td className="py-1.5 tabular-nums">{f.oldest_waiting ? ageLabel(f.oldest_waiting) : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </HorizontalScroll>
          <div className="grid gap-1">
            <h3 className="text-xs font-semibold text-muted-foreground">Mailboxes</h3>
            {summary.mailboxes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No mailbox is connected.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {summary.mailboxes.map((m) => (
                  <li key={m.address} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{m.address}</span>
                    {!m.active ? <StatusPill tone="muted">Off</StatusPill> : null}
                    <span className="text-muted-foreground">
                      {m.last_sync_succeeded_at ? `Last read ${formatFacilityTimestampEt(m.last_sync_succeeded_at)} ET` : "Not read yet"}
                    </span>
                    {m.last_error_code ? (
                      <StatusPill tone="danger">
                        Error {m.last_error_code}
                        {m.last_error_at ? ` · ${formatFacilityTimestampEt(m.last_error_at)} ET` : ""}
                      </StatusPill>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
