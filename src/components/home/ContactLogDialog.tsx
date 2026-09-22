"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONTACT_KINDS, logCollectionContact, type ContactKind } from "@/lib/home/notes";
import { createClient } from "@/lib/supabase/client";

export type ContactLogDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  residentName: string;
  onLogged?: () => void;
  /** Injected in tests. */
  log?: typeof logCollectionContact;
};

/**
 * Collections contact on a past-due resident (COL-595). Lands in the
 * resident's contact history. A letter stays off until the templates exist.
 */
export function ContactLogDialog({ open, onOpenChange, residentId, residentName, onLogged, log = logCollectionContact }: ContactLogDialogProps) {
  const ids = useId();
  const [kind, setKind] = useState<ContactKind | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState(() => crypto.randomUUID());

  async function submit() {
    if (!kind || !note.trim() || busy) return;
    setBusy(true);
    const result = await log(createClient(), { id, residentId, kind, note });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setKind(""); setNote(""); setError(null); setId(crypto.randomUUID());
    onLogged?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Log contact</DialogTitle>
          <DialogDescription>{residentName}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="What happened">
            {CONTACT_KINDS.map((k) => (
              <Button key={k.value} type="button" size="sm" variant={kind === k.value ? "default" : "outline"} role="radio" aria-checked={kind === k.value} onClick={() => setKind(k.value)} className="justify-start">
                {k.label}
              </Button>
            ))}
            <Button type="button" size="sm" variant="outline" disabled className="justify-start" title="Letter templates are not set up yet.">
              Send a letter — templates not set up yet
            </Button>
          </div>
          {kind === "voicemail" ? <p className="text-xs text-muted-foreground">A call-back is scheduled for the next day.</p> : null}
          <div className="grid gap-1">
            <label htmlFor={`${ids}-note`} className="text-sm font-medium">Note</label>
            <textarea id={`${ids}-note`} className="min-h-16 rounded-md border border-border bg-background px-2.5 py-2 text-[13px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Spoke to the son; paying Friday." />
          </div>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!kind || !note.trim() || busy}>{busy ? "Saving…" : "Log contact"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
