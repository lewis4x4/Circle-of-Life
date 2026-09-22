"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";

import { createClient } from "@/lib/supabase/client";

const escalationSchema = z.object({
  instanceId: z.string(),
  facilityId: z.string(),
  facilityName: z.string(),
  title: z.string(),
  assignedShiftDate: z.string(),
  status: z.string(),
  escalatedAt: z.string().nullable().optional(),
  owner: z.union([
    z.object({ kind: z.literal("queue") }),
    z.object({ kind: z.literal("user"), userId: z.string(), displayName: z.string().nullable().optional() }),
  ]),
  href: z.string(),
});

export type ExecutiveEscalation = z.infer<typeof escalationSchema>;

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
        const parsed = z.array(escalationSchema).safeParse(data ?? []);
        setState(parsed.success ? { state: "ready", rows: parsed.data } : { state: "unavailable" });
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
