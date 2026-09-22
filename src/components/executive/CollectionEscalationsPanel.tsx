"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export type CollectionEscalation = {
  activityId: string;
  facilityName: string;
  residentName: string;
  note: string;
  activityDate: string;
  by?: string | null;
};

export function parseCollectionEscalations(data: unknown): CollectionEscalation[] | null {
  if (!Array.isArray(data)) return null;
  const rows: CollectionEscalation[] = [];
  for (const item of data) {
    const row = item as Record<string, unknown>;
    if (typeof row?.activityId !== "string" || typeof row.facilityName !== "string" || typeof row.residentName !== "string"
      || typeof row.note !== "string" || typeof row.activityDate !== "string") return null;
    rows.push({ activityId: row.activityId, facilityName: row.facilityName, residentName: row.residentName, note: row.note,
      activityDate: row.activityDate, by: typeof row.by === "string" ? row.by : null });
  }
  return rows;
}

/**
 * Collections escalated from a building's Home (COL-595), for the named
 * Facility Executive. Renders nothing when there is nothing.
 */
export function CollectionEscalationsPanel({ load }: { load?: () => Promise<unknown> } = {}) {
  const [rows, setRows] = useState<CollectionEscalation[]>([]);
  useEffect(() => {
    let active = true;
    const read = load ?? (async () => {
      const rpc = createClient().rpc as unknown as (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { data, error } = await rpc("home_collection_escalations_for_executive");
      if (error) throw new Error(error.message);
      return data;
    });
    read().then((data) => { if (active) setRows(parseCollectionEscalations(data ?? []) ?? []); }).catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [load]);
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border border-warning/40 bg-card" aria-labelledby="collections-escalated-heading" data-testid="collections-escalated">
      <div className="border-b border-border/60 px-4 py-3">
        <h2 id="collections-escalated-heading" className="text-[15px] font-semibold tracking-tight text-foreground">Collections escalated to you</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Past-due rent a building escalated in the last two weeks.</p>
      </div>
      <ul className="list-none">
        {rows.map((row) => (
          <li key={row.activityId} className="border-b border-border/60 px-4 py-2.5 text-[13px] last:border-b-0">
            <p className="text-foreground">{row.residentName} <span className="text-xs text-muted-foreground">· {row.facilityName} · {row.activityDate}{row.by ? ` · ${row.by}` : ""}</span></p>
            <p className="text-xs text-muted-foreground">{row.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
