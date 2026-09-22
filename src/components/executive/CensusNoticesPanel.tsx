"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export type CensusNotice = {
  id: string;
  facilityName: string;
  censusMonth: string;
  outcome: "confirmed" | "flagged";
  note: string | null;
  recordedAt: string;
  recordedBy: string | null;
  rosterCensus: number | null;
  monthEndOccupied: number | null;
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Hand-rolled guard: this panel sits on the executive route's first load, so no schema library here. */
export function parseCensusNotices(data: unknown): CensusNotice[] | null {
  if (!Array.isArray(data)) return null;
  const rows: CensusNotice[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (!isString(row.id) || !isString(row.facilityName) || !isString(row.censusMonth) || !isString(row.recordedAt)) return null;
    if (row.outcome !== "confirmed" && row.outcome !== "flagged") return null;
    rows.push({
      id: row.id,
      facilityName: row.facilityName,
      censusMonth: row.censusMonth,
      outcome: row.outcome,
      note: isString(row.note) ? row.note : null,
      recordedAt: row.recordedAt,
      recordedBy: isString(row.recordedBy) ? row.recordedBy : null,
      rosterCensus: numOrNull(row.rosterCensus),
      monthEndOccupied: numOrNull(row.monthEndOccupied),
    });
  }
  return rows;
}

function monthLabel(censusMonth: string) {
  const [y, m] = censusMonth.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, (m ?? 1) - 1, 1, 12)));
}

type PanelState = { state: "loading" } | { state: "ready"; rows: CensusNotice[] } | { state: "unavailable" };

/**
 * Monthly census confirmations and "something wrong" flags from buildings
 * where the caller is the named Facility Executive (COL-569). Reads
 * `home_census_notices_for_executive`; renders nothing when there is nothing.
 * Push and email wait on COL-152.
 */
export function CensusNoticesPanel({ load }: { load?: () => Promise<unknown> } = {}) {
  const [state, setState] = useState<PanelState>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    const read = load ?? (async () => {
      const { data, error } = await createClient().rpc("home_census_notices_for_executive");
      if (error) throw new Error(error.message);
      return data;
    });
    read()
      .then((data) => {
        if (cancelled) return;
        const rows = parseCensusNotices(data ?? []);
        setState(rows ? { state: "ready", rows } : { state: "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setState({ state: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (state.state !== "ready" || state.rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card" aria-labelledby="census-notices-heading" data-testid="census-notices">
      <div className="border-b border-border/60 px-4 py-3">
        <h2 id="census-notices-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
          Monthly census from your buildings
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What each administrator confirmed, or flagged as wrong, on the first business day. Counts only.
        </p>
      </div>
      <ul className="list-none">
        {state.rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-4 py-2.5 text-[13px] last:border-b-0">
            <span className="text-foreground">
              {row.facilityName} · {monthLabel(row.censusMonth)}
              <span className="ml-2 text-xs text-muted-foreground">
                {row.outcome === "confirmed" ? "Confirmed" : "Something wrong"}
                {row.recordedBy ? ` by ${row.recordedBy}` : ""}
                {row.rosterCensus != null ? ` · roster ${row.rosterCensus}` : ""}
                {row.monthEndOccupied != null ? ` · month-end ${row.monthEndOccupied}` : ""}
              </span>
            </span>
            {row.outcome === "flagged" && row.note ? <span className="text-xs text-foreground">“{row.note}”</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
