"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CALLOUT_REASONS,
  callableShifts,
  coverShift,
  fetchShiftsToday,
  recordCallout,
  shiftLabel,
  type CalloutReason,
  type HomeShiftsToday,
} from "@/lib/home/call-out";
import { createClient } from "@/lib/supabase/client";

const BIG = "h-11 justify-start text-[15px]";

export type CallOutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  /** Opened from an uncovered row: skip straight to covering this shift. */
  coverAssignmentId?: string | null;
  onChanged?: () => void;
  /** Injected in tests. */
  load?: (facilityId: string) => Promise<HomeShiftsToday>;
  record?: typeof recordCallout;
  cover?: typeof coverShift;
};

/**
 * Call-out from Home (COL-596), phone-first: who → reason → Record, then
 * optionally cover it from the same screen. The shift is filled in from the
 * schedule; nothing is typed that the schedule already knows.
 */
export function CallOutDialog({
  open, onOpenChange, facilityId, coverAssignmentId = null, onChanged,
  load = (id) => fetchShiftsToday(createClient(), id), record = recordCallout, cover = coverShift,
}: CallOutDialogProps) {
  const ids = useId();
  const [today, setToday] = useState<HomeShiftsToday | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [assignmentId, setAssignmentId] = useState<string>("");
  const [reason, setReason] = useState<CalloutReason | "">("");
  const [note, setNote] = useState("");
  const [coverFor, setCoverFor] = useState<string | null>(coverAssignmentId);
  const [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [eventId] = useState(() => crypto.randomUUID());
  const [coverId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    let active = true;
    load(facilityId).then((value) => { if (active) setToday(value); }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [open, facilityId, load]);

  const shifts = today ? callableShifts(today) : [];
  const gap = today?.shifts.find((s) => s.assignmentId === coverFor) ?? null;
  const onShift = new Set(today?.shifts.filter((s) => gap && s.shiftType === gap.shiftType && !["called_out", "no_show"].includes(s.status)).map((s) => s.staffId));
  const candidates = today?.staff.filter((p) => p.staffId !== gap?.staffId && !onShift.has(p.staffId)) ?? [];

  async function submitCallout() {
    if (!assignmentId || !reason || busy) return;
    setBusy(true);
    const result = await record(createClient(), { eventId, assignmentId, reason, note });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    onChanged?.();
    setCoverFor(assignmentId);
    setToday(await load(facilityId).catch(() => today));
  }

  async function submitCover() {
    if (!coverFor || !replacement || busy) return;
    setBusy(true);
    const result = await cover(createClient(), { id: coverId, assignmentId: coverFor, staffId: replacement });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    setDone("Covered. The shift is on the schedule for them.");
    onChanged?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{coverFor ? "Cover the shift" : "Call-out"}</DialogTitle>
          <DialogDescription>
            {coverFor ? (gap ? `${gap.staffName} · ${shiftLabel(gap)} is uncovered.` : "Loading…") : "Who called out today?"}
          </DialogDescription>
        </DialogHeader>
        {loadError ? <p role="alert" className="text-sm text-destructive">Today’s schedule could not be loaded.</p> : null}
        {done ? (
          <div className="space-y-3" role="status">
            <p className="text-sm">{done}</p>
            <DialogFooter><Button type="button" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
          </div>
        ) : coverFor ? (
          <div className="grid gap-3">
            <label htmlFor={`${ids}-replacement`} className="text-sm font-medium">Who is covering?</label>
            <select id={`${ids}-replacement`} className="h-11 rounded-md border border-border bg-background px-2.5 text-[15px]" value={replacement} onChange={(e) => setReplacement(e.target.value)}>
              <option value="">Pick a replacement</option>
              {candidates.map((p) => <option key={p.staffId} value={p.staffId}>{p.staffName}</option>)}
            </select>
            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Leave it uncovered for now</Button>
              <Button type="button" disabled={!replacement || busy} onClick={() => void submitCover()}>{busy ? "Saving…" : "Cover it"}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Who">
              {today && shifts.length === 0 ? <p className="text-sm text-muted-foreground">Nobody else is scheduled today.</p> : null}
              {shifts.map((shift) => (
                <Button key={shift.assignmentId} type="button" variant={assignmentId === shift.assignmentId ? "default" : "outline"} className={BIG} role="radio" aria-checked={assignmentId === shift.assignmentId} onClick={() => setAssignmentId(shift.assignmentId)}>
                  {shift.staffName} <span className="ml-auto text-xs opacity-80">{shiftLabel(shift)}</span>
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Reason">
              {CALLOUT_REASONS.map((r) => (
                <Button key={r.value} type="button" variant={reason === r.value ? "default" : "outline"} className="h-11" role="radio" aria-checked={reason === r.value} onClick={() => setReason(r.value)}>{r.label}</Button>
              ))}
            </div>
            <label htmlFor={`${ids}-note`} className="sr-only">Note (optional)</label>
            <textarea id={`${ids}-note`} className="min-h-12 rounded-md border border-border bg-background px-2.5 py-1.5 text-[15px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" className="h-11" disabled={!assignmentId || !reason || busy} onClick={() => void submitCallout()}>{busy ? "Saving…" : "Record call-out"}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
