"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export type ExecutiveEscalation = {
  instanceId: string;
  facilityId: string;
  facilityName: string;
  title: string;
  assignedShiftDate: string;
  status: string;
  escalatedAt?: string | null;
  owner: { kind: "queue" } | { kind: "user"; userId: string; displayName?: string | null };
  href: string;
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Hand-rolled guard: this panel sits on the executive route's first load, so no schema library here. */
export function parseExecutiveEscalations(data: unknown): ExecutiveEscalation[] | null {
  if (!Array.isArray(data)) return null;
  const rows: ExecutiveEscalation[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const owner = row.owner as Record<string, unknown> | undefined;
    if (!isString(row.instanceId) || !isString(row.facilityId) || !isString(row.facilityName) || !isString(row.title)
      || !isString(row.assignedShiftDate) || !isString(row.status) || !isString(row.href) || !owner) return null;
    if (owner.kind === "queue") {
      rows.push({ instanceId: row.instanceId, facilityId: row.facilityId, facilityName: row.facilityName, title: row.title, assignedShiftDate: row.assignedShiftDate, status: row.status, escalatedAt: isString(row.escalatedAt) ? row.escalatedAt : null, owner: { kind: "queue" }, href: row.href });
    } else if (owner.kind === "user" && isString(owner.userId)) {
      rows.push({ instanceId: row.instanceId, facilityId: row.facilityId, facilityName: row.facilityName, title: row.title, assignedShiftDate: row.assignedShiftDate, status: row.status, escalatedAt: isString(row.escalatedAt) ? row.escalatedAt : null, owner: { kind: "user", userId: owner.userId, displayName: isString(owner.displayName) ? owner.displayName : null }, href: row.href });
    } else {
      return null;
    }
  }
  return rows;
}

type PanelState = { state: "loading" } | { state: "ready"; rows: ExecutiveEscalation[] } | { state: "unavailable" };

function formatShortDate(dateIso: string) {
  const [, m, d] = dateIso.split("-");
  return `${m}/${d}`;
}

/**
 * What the Facility Executive receives from a building's operator queue at the
 * end of its day (COL-593 §5.4). Reads `home_escalations_for_executive`, which
 * answers only for facilities where the caller is the named executive; renders
 * nothing when there is nothing. Push and email wait on COL-152.
 */
export function EscalatedFromFacilitiesPanel({ load }: { load?: () => Promise<unknown> } = {}) {
  const [state, setState] = useState<PanelState>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    const read = load ?? (async () => {
      const { data, error } = await createClient().rpc("home_escalations_for_executive");
      if (error) throw new Error(error.message);
      return data;
    });
    read()
      .then((data) => {
        if (cancelled) return;
        const rows = parseExecutiveEscalations(data ?? []);
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

  const byFacility = new Map<string, ExecutiveEscalation[]>();
  for (const row of state.rows) {
    byFacility.set(row.facilityName, [...(byFacility.get(row.facilityName) ?? []), row]);
  }

  return (
    <section className="rounded-lg border border-emar-held/40 bg-card" aria-labelledby="escalated-heading" data-testid="escalated-from-facilities">
      <div className="border-b border-border/60 px-4 py-3">
        <h2 id="escalated-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
          Escalated to you
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Rows a building did not clear by the end of its operator day. They stay here until the facility clears them.
        </p>
      </div>
      <ul className="list-none">
        {[...byFacility.entries()].map(([facilityName, rows]) => (
          <li key={facilityName} className="border-b border-border/60 px-4 py-3 last:border-b-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Escalated from {facilityName}</p>
            <ul className="mt-1.5 flex list-none flex-col gap-1.5">
              {rows.map((row) => (
                <li key={row.instanceId} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="text-foreground">
                    {row.title}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatShortDate(row.assignedShiftDate)}
                      {row.owner.kind === "user" ? ` · claimed by ${row.owner.displayName ?? "a colleague"}` : " · unclaimed"}
                    </span>
                  </span>
                  <Link href={row.href} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                    Open →
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
