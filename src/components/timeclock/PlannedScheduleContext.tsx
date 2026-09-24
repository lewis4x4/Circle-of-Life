"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchScheduleAssignmentIntervals, formatAssignmentInterval, type ScheduleAssignmentInterval } from "@/lib/schedules/assignment-context";
import { createClient } from "@/lib/supabase/client";
import { enumLabel } from "@/lib/display/enum-label";

type ContextState = { status: "loading" } | { status: "unavailable" } | { status: "ready"; rows: ScheduleAssignmentInterval[] };

/** Live planning evidence is deliberately separate from punches and frozen payroll snapshots. */
export function PlannedScheduleContext({ facilityIds, staffId, from, to, compact = false, payroll = false }: {
  facilityIds: string[]; staffId?: string; from: string; to: string; compact?: boolean; payroll?: boolean;
}) {
  const scope = [...new Set(facilityIds)].sort().join(",");
  const key = `${scope}:${staffId ?? "all"}:${from}:${to}`;
  const [result, setResult] = useState<{ key: string; state: ContextState } | null>(null);
  const [retry, setRetry] = useState(0);
  const state: ContextState = result?.key === key ? result.state : { status: "loading" };
  useEffect(() => {
    let cancelled = false;
    if (!scope && !staffId) { setResult({ key, state: { status: "unavailable" } }); return; }
    setResult({ key, state: { status: "loading" } });
    void Promise.all((scope ? scope.split(",") : [null]).map((facilityId) => fetchScheduleAssignmentIntervals(createClient(), { facilityId, staffId, from, to })))
      .then((groups) => {
        if (cancelled) return;
        const rows = [...new Map(groups.flat().filter((row) => !staffId || row.staff_id === staffId).map((row) => [row.assignment_id, row])).values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.assignment_id.localeCompare(b.assignment_id));
        setResult({ key, state: { status: "ready", rows } });
      }).catch(() => { if (!cancelled) setResult({ key, state: { status: "unavailable" } }); });
    return () => { cancelled = true; };
  }, [scope, staffId, from, to, key, retry]);
  const minutes = state.status === "ready" ? state.rows.reduce((sum, row) => sum + Math.max(0, Math.min(Date.parse(row.ends_at), Date.parse(to)) - Math.max(Date.parse(row.starts_at), Date.parse(from))) / 60000, 0) : null;
  return <section aria-label="Published schedule context" className="space-y-2 rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Published schedule context</h2><Link className="text-sm text-primary underline" href="/admin/schedules">Open schedule</Link></div>
    <p className="text-sm text-muted-foreground">{payroll ? "Live planned work is shown for comparison only. It does not change this packet’s paid hours, approval or saved documents." : "Compare planned blocks with actual punches. Scheduled hours do not count as worked or paid hours."}</p>
    {state.status === "loading" ? <p role="status" className="text-sm">Loading published work blocks…</p> : state.status === "unavailable" ? <p className="text-sm text-muted-foreground">Schedule context could not be loaded. Actual time records remain available. <button type="button" className="text-primary underline" onClick={() => setRetry((value) => value + 1)}>Retry schedule context</button></p> : <>
      <p className="text-sm">{state.rows.length ? `${state.rows.length} published work ${state.rows.length === 1 ? "block" : "blocks"} · ${(minutes! / 60).toFixed(2)} planned hours in this period` : "No published work blocks were found in this period and facility scope."}</p>
      {!compact && state.rows.length > 0 && <ul className="space-y-2">{state.rows.map((row) => <li key={row.assignment_id} className="flex flex-wrap items-center gap-2 text-sm">
        {row.color && /^#[0-9a-f]{6}$/i.test(row.color) && <span aria-hidden className="size-3 rounded-full border border-border" style={{ backgroundColor: row.color }} />}
        <span>{row.service_date} · {formatAssignmentInterval(row)}{row.staff_role ? ` · ${enumLabel(row.staff_role)}` : ""}{row.block_count && row.block_count > 1 ? ` · block ${(row.block_index ?? 0) + 1} of ${row.block_count}` : ""}</span>
        <Link className="text-primary underline" href={`/admin/schedules/${row.schedule_id}`}>View schedule</Link>
      </li>)}</ul>}
      {state.rows.some((row) => (row.block_count ?? 0) > 1) && <p className="text-sm text-muted-foreground">Split blocks leave a planned gap. Record actual out/in events; no gap or meal is deducted from a schedule. Any short-turnaround exception still requires review.</p>}
    </>}
  </section>;
}
