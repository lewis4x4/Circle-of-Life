"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NOTE_TYPES, createNote, fetchNoteAssignees, isTask, type HomeNoteAssignees, type NoteType } from "@/lib/home/notes";
import { createClient } from "@/lib/supabase/client";

const FIELD = "h-9 w-full rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type ResidentOption = { id: string; name: string };

export type QuickNoteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  localDate: string;
  onSaved?: () => void;
  /** Injected in tests. */
  loadAssignees?: (facilityId: string) => Promise<HomeNoteAssignees>;
  loadResidents?: (facilityId: string) => Promise<ResidentOption[]>;
  save?: typeof createNote;
};

async function defaultResidents(facilityId: string): Promise<ResidentOption[]> {
  const { data, error } = await createClient()
    .from("residents")
    .select("id, first_name, last_name, preferred_name")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .order("last_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, name: `${row.last_name}, ${row.preferred_name || row.first_name}` }));
}

/**
 * Quick note (COL-595). Type and text are required; a resident link is
 * optional. Add a person, a vendor or a follow-up date and it becomes a task
 * that shows up in On tap on that date.
 */
export function QuickNoteDialog({
  open, onOpenChange, facilityId, localDate, onSaved,
  loadAssignees = (id) => fetchNoteAssignees(createClient(), id),
  loadResidents = defaultResidents,
  save = createNote,
}: QuickNoteDialogProps) {
  const ids = useId();
  const [noteType, setNoteType] = useState<NoteType | "">("");
  const [body, setBody] = useState("");
  const [residentId, setResidentId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [assignees, setAssignees] = useState<HomeNoteAssignees | null>(null);
  const [residents, setResidents] = useState<ResidentOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    let active = true;
    loadAssignees(facilityId).then((value) => { if (active) setAssignees(value); }).catch(() => { if (active) setAssignees({ people: [], vendors: [] }); });
    loadResidents(facilityId).then((value) => { if (active) setResidents(value); }).catch(() => { if (active) setResidents([]); });
    return () => { active = false; };
  }, [open, facilityId, loadAssignees, loadResidents]);

  function reset() {
    setNoteType(""); setBody(""); setResidentId(""); setAssignee(""); setFollowUpDate(""); setError(null); setId(crypto.randomUUID());
  }

  const ready = Boolean(noteType && body.trim());
  const task = isTask({ assignee, followUpDate });

  async function submit() {
    if (!ready || busy || !noteType) return;
    setBusy(true);
    setError(null);
    const result = await save(createClient(), { id, facilityId, noteType, body, residentId: residentId || null, assignee, followUpDate });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    reset();
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Quick note</DialogTitle>
          <DialogDescription>Add a person, a vendor or a follow-up date and it becomes a task on that date.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <fieldset className="grid gap-1">
            <legend className="text-sm font-medium">Type</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
              {NOTE_TYPES.map((type) => (
                <Button key={type.value} type="button" size="sm" variant={noteType === type.value ? "default" : "outline"} role="radio" aria-checked={noteType === type.value} onClick={() => setNoteType(type.value)}>
                  {type.label}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-body`}>Note</Label>
            <textarea id={`${ids}-body`} className="min-h-20 rounded-md border border-border bg-background px-2.5 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-resident`}>Resident (optional)</Label>
            <select id={`${ids}-resident`} className={FIELD} value={residentId} onChange={(e) => setResidentId(e.target.value)} disabled={!residents}>
              <option value="">No resident</option>
              {residents?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor={`${ids}-assignee`}>Assign to (optional)</Label>
              <select id={`${ids}-assignee`} className={FIELD} value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!assignees}>
                <option value="">Nobody</option>
                {assignees?.people.length ? (
                  <optgroup label="People">
                    {assignees.people.map((p) => <option key={p.userId} value={`user:${p.userId}`}>{p.displayName ?? "Unnamed"}</option>)}
                  </optgroup>
                ) : null}
                {assignees?.vendors.length ? (
                  <optgroup label="Vendors">
                    {assignees.vendors.map((v) => <option key={v.vendorId} value={`vendor:${v.vendorId}`}>{v.displayName}</option>)}
                  </optgroup>
                ) : null}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${ids}-date`}>Follow up on (optional)</Label>
              <Input id={`${ids}-date`} type="date" min={localDate} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">{task ? "This will be a task." : "This will be a note on the facility."}</p>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!ready || busy}>{busy ? "Saving…" : task ? "Save task" : "Save note"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
