"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SwapWorkContext } from "@/components/staffing/SwapWorkContext";
import { fetchScheduleAssignmentIntervals, type ScheduleAssignmentInterval } from "@/lib/schedules/assignment-context";
import { parseSwapBlocks, shiftSwapOptions, type SwapBlock } from "@/lib/staffing/shift-swap-groups";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { createClient } from "@/lib/supabase/client";

type Candidate = { staff_id: string; staff_name: string; staff_role: string; blocks: unknown };
const fieldClass = "mt-1 w-full rounded-md border border-input bg-background p-2 text-sm";

/** Requests are created only for a verified own-staff anchor; SQL derives the consent evidence. */
export function NewShiftSwapRequest({ ownStaffIds, organizationId, onCreated }: {
  ownStaffIds: string[]; organizationId: string; onCreated: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [work, setWork] = useState<ScheduleAssignmentInterval[]>([]);
  const [anchorId, setAnchorId] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [coverId, setCoverId] = useState("");
  const [exchangeId, setExchangeId] = useState("");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = shiftSwapOptions(work);
  const selected = options.find((option) => option.anchor.assignment_id === anchorId);
  const cover = candidates.find((candidate) => candidate.staff_id === coverId);
  const offeredOptions = shiftSwapOptions(parseSwapBlocks(cover?.blocks) ?? []);
  const offered = offeredOptions.find((option) => option.anchor.assignment_id === exchangeId);
  const group = selected?.scope === "group" || offered?.scope === "group";

  async function start() {
    setOpen(true); setBusy(true); setError(null);
    setAnchorId(""); setCandidates([]); setCoverId(""); setExchangeId(""); setReviewed(false);
    try {
      const now = new Date();
      const lists = await Promise.all(ownStaffIds.map((staffId) => fetchScheduleAssignmentIntervals(supabase, {
        facilityId: null, staffId, from: now, to: new Date(now.getTime() + 42 * 86400000),
      })));
      setWork(lists.flat().filter((row) => Date.parse(row.starts_at) > now.getTime()));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load your published work."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!anchorId) return;
    let current = true;
    setCandidatesLoading(true); setError(null);
    setCandidates([]); setCoverId(""); setExchangeId(""); setReviewed(false);
    void readAllPages<Candidate>(async (from, to) => {
      const result = await supabase.rpc("schedule_swap_candidates" as never, { p_assignment_id: anchorId } as never, { count: "exact" })
        .order("staff_name").order("staff_id").range(from, to);
      return { data: result.data as unknown as Candidate[] | null, count: result.count, error: result.error };
    }).then((result) => { if (current) setCandidates(result.data.filter((candidate) => !ownStaffIds.includes(candidate.staff_id))); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Could not load eligible coworkers."); })
      .finally(() => { if (current) setCandidatesLoading(false); });
    return () => { current = false; };
  }, [anchorId, supabase, ownStaffIds]);

  async function submit() {
    if (!selected || !cover || !reviewed || busy || candidatesLoading || (exchangeId && !offered)) return;
    setBusy(true); setError(null);
    try {
      if (!organizationId || !ownStaffIds.includes(selected.anchor.staff_id)) throw new Error("Your staff identity is unavailable. Reload before creating a request.");
      const result = await supabase.from("shift_swap_requests" as never).insert({
        organization_id: organizationId, facility_id: selected.anchor.facility_id,
        requesting_staff_id: selected.anchor.staff_id, requesting_assignment_id: selected.anchor.assignment_id,
        covering_staff_id: cover.staff_id, covering_assignment_id: offered?.anchor.assignment_id ?? null,
        swap_scope: group ? "group" : "assignment", swap_type: offered ? "swap" : "cover",
        reason: reason.trim() || null, status: "pending",
      } as never).select("id").single();
      if (result.error) throw new Error(result.error.message);
      setOpen(false); setAnchorId(""); setCoverId(""); setExchangeId(""); setReviewed(false); setReason("");
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The request was not created. Reload before trying again."); }
    finally { setBusy(false); }
  }

  if (!open) return <Button type="button" variant="outline" disabled={!ownStaffIds.length} onClick={() => void start()}>Request coverage or exchange</Button>;
  const requestedBlocks: SwapBlock[] = selected?.blocks.map((row) => ({ ...row, staff_role: row.staff_role })) ?? [];
  return <section aria-label="New shift swap request" className="space-y-3 rounded-lg border border-border p-4">
    <h2 className="font-semibold">Request coverage or exchange</h2>
    <p className="text-sm text-muted-foreground">Choose published work in the next six weeks. Each split shift is one option containing all its blocks. Both employees confirm the saved request before manager review.</p>
    {error && <p role="alert" className="text-sm text-warning">{error}</p>}
    <label className="block text-sm">Your work
      <select className={fieldClass} disabled={busy} value={anchorId} onChange={(event) => { setAnchorId(event.target.value); setCandidates([]); setCoverId(""); setExchangeId(""); setReviewed(false); }}>
        <option value="">{busy ? "Loading…" : "Choose a work block or whole group"}</option>
        {options.map((option) => <option key={option.anchor.assignment_id} value={option.anchor.assignment_id}>{option.anchor.service_date} · {option.anchor.label} · {option.blocks.length} {option.blocks.length === 1 ? "block" : "blocks"} · {option.hours.toFixed(1)} hours</option>)}
      </select>
    </label>
    {!busy && !options.length && <p className="text-sm text-muted-foreground">No complete future published work is available for a new request.</p>}
    {selected && <>
      <label className="block text-sm">Coworker
        <select className={fieldClass} disabled={busy || candidatesLoading} value={coverId} onChange={(event) => { setCoverId(event.target.value); setExchangeId(""); setReviewed(false); }}>
          <option value="">{candidatesLoading ? "Loading eligible coworkers…" : "Choose a coworker"}</option>
          {candidates.map((candidate) => <option key={candidate.staff_id} value={candidate.staff_id}>{candidate.staff_name}</option>)}
        </select>
      </label>
      {cover && <label className="block text-sm">Work offered in exchange
        <select className={fieldClass} disabled={busy} value={exchangeId} onChange={(event) => { setExchangeId(event.target.value); setReviewed(false); }}>
          <option value="">No exchange: cover my requested work</option>
          {offeredOptions.map((option) => <option key={option.anchor.assignment_id} value={option.anchor.assignment_id}>{option.anchor.service_date} · {option.anchor.label} · {option.blocks.length} blocks · {option.hours.toFixed(1)} hours</option>)}
        </select>
      </label>}
      <SwapWorkContext row={{ swap_scope: "assignment", requesting_group_snapshot: requestedBlocks, covering_group_snapshot: offered?.blocks ?? [] }} />
      {group && <p className="text-sm font-medium">This request moves whole groups. Every listed block is included.</p>}
      <label className="block text-sm">Reason (optional)<textarea className={fieldClass} value={reason} maxLength={1000} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || !cover} onChange={(event) => setReviewed(event.target.checked)} />I reviewed every listed block and want to create this request. Both participants will confirm the saved details separately.</label>
    </>}
    <div className="flex gap-2"><Button type="button" disabled={busy || candidatesLoading || !selected || !cover || !reviewed} onClick={() => void submit()}>Create request</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button></div>
  </section>;
}
