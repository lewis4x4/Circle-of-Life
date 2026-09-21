"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { bedMoveErrorMessage, loadBedMoveSnapshot, type BedMoveSnapshot } from "@/lib/residents/bed-move";

export function ChangeBedAction({ residentId, residentName, facilityId, currentBedLabel, initiallyOpen = false, onDone }: {
  residentId: string;
  residentName: string;
  facilityId: string;
  currentBedLabel: string;
  initiallyOpen?: boolean;
  onDone?: () => void;
}) {
  const { appRole, loading: authLoading } = useHavenAuth();
  const permitted = !authLoading && ["owner", "org_admin", "facility_admin", "nurse"].includes(appRole);
  const [open, setOpen] = useState(initiallyOpen);
  const [snapshot, setSnapshot] = useState<BedMoveSnapshot | null>(null);
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const generation = useRef(0);
  const savingRef = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setSnapshot(null);
    setTarget("");
    try {
      const next = await loadBedMoveSnapshot(createClient(), facilityId, residentId);
      if (request === generation.current) setSnapshot(next);
    } catch (error) {
      if (request === generation.current) setProblem(error instanceof Error ? error.message : "Bed availability could not be verified.");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [facilityId, residentId]);

  useEffect(() => {
    if (open && permitted) void refresh();
    return () => { generation.current += 1; };
  }, [open, permitted, refresh]);

  const selected = snapshot?.options.find((bed) => bed.id === target);
  async function save() {
    if (!permitted || !snapshot || !selected || selected.conflict || loading || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const { data, error } = await createClient().rpc("change_resident_bed" as never, {
        p_resident_id: residentId, p_target_bed_id: selected.id, p_expected_bed_id: snapshot.currentBedId,
      } as never);
      if (error) throw error;
      if (data !== selected.id) throw new Error("Missing bed change receipt");
      toast.success(`${residentName} is now assigned to ${selected.label}.`);
      setOpen(false);
      onDone?.();
    } catch (error) {
      setProblem(bedMoveErrorMessage(error));
      await refresh();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!permitted) return null;
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => { setProblem(null); setOpen(true); }}>Change bed</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!saving) { setOpen(next); setProblem(null); } }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Change bed — {residentName}</DialogTitle>
          <DialogDescription>Choose a bed in this resident’s facility. Availability is checked again when you confirm.</DialogDescription>
        </DialogHeader>
        {snapshot ? <p className="text-sm text-muted-foreground">Facility: {snapshot.facilityName}</p> : null}
        <p className="text-sm">Current bed: <strong>{snapshot?.currentBedLabel ?? currentBedLabel}</strong></p>
        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        {loading ? <p role="status" className="text-sm text-muted-foreground">Checking bed availability…</p> : null}
        {snapshot ? <fieldset disabled={saving || loading} className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Choose a new bed</legend>
          {snapshot.options.length === 0 ? <p className="text-sm text-muted-foreground">No beds are configured for this facility.</p> : <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
            {snapshot.options.map((bed) => <label key={bed.id} className={`flex items-start gap-3 border-b border-border p-3 last:border-b-0 ${bed.conflict ? "bg-muted/40 text-muted-foreground" : "cursor-pointer hover:bg-muted/30"}`}>
              <input type="radio" name={`bed-${residentId}`} value={bed.id} checked={target === bed.id} disabled={Boolean(bed.conflict)} onChange={() => setTarget(bed.id)} className="mt-1" />
              <span className="text-sm"><span className="block font-medium">{bed.label}</span><span className="block text-xs">{bed.conflict ?? "Available"}</span></span>
            </label>)}
          </div>}
          {snapshot.options.length > 0 && !snapshot.options.some((bed) => !bed.conflict) ? <p className="text-sm text-muted-foreground">No available beds. Resolve a conflict or release a bed before moving this resident.</p> : null}
        </fieldset> : null}
        {selected && !selected.conflict ? <p className="rounded-lg bg-muted p-3 text-sm">Move {residentName} from {snapshot?.currentBedLabel} to <strong>{selected.label}</strong>.</p> : null}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={saving || loading} onClick={() => { setProblem(null); void refresh(); }}>Refresh availability</Button>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" disabled={saving || loading || !selected || Boolean(selected.conflict)} onClick={() => void save()}>{saving ? "Changing bed…" : "Confirm bed change"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
