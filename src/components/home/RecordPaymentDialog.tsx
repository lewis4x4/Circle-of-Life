"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PAYMENT_METHODS,
  dollarsToCents,
  formatCents,
  recordPaymentOnHome,
  type PaymentMethod,
  type RecordPaymentOutcome,
} from "@/lib/home/record-payment";
import { createClient } from "@/lib/supabase/client";

type ResidentOption = { id: string; name: string };

export type RecordPaymentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  /** The facility's local date; a payment defaults to today there, not in UTC. */
  localDate: string;
  onRecorded?: () => void;
  /** Injected in tests. */
  loadResidents?: (facilityId: string) => Promise<ResidentOption[]>;
  record?: typeof recordPaymentOnHome;
};

const FIELD = "h-9 w-full rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

async function defaultLoadResidents(facilityId: string): Promise<ResidentOption[]> {
  const { data, error } = await createClient()
    .from("residents")
    .select("id, first_name, last_name, preferred_name")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .order("last_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: `${row.last_name}, ${row.preferred_name || row.first_name}`,
  }));
}

/**
 * Record payment on Home (COL-594). Resident → amount → photo → Record. No
 * balance is shown here (balances stay off Home until they tie to the office
 * A/R for a full month); the server says when the amount is not the full open
 * balance, and only then is a reason asked for.
 */
export function RecordPaymentDialog({ open, onOpenChange, facilityId, localDate, onRecorded, loadResidents = defaultLoadResidents, record = recordPaymentOnHome }: RecordPaymentDialogProps) {
  const ids = useId();
  const [residents, setResidents] = useState<ResidentOption[] | null>(null);
  const [residentsError, setResidentsError] = useState(false);
  const [residentId, setResidentId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [reference, setReference] = useState("");
  const [payerName, setPayerName] = useState("");
  const [paymentDate, setPaymentDate] = useState(localDate);
  const [photo, setPhoto] = useState<File | null>(null);
  const [reasonAsked, setReasonAsked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<RecordPaymentOutcome, { kind: "recorded" }> | null>(null);
  // One identity per attempt at one payment, so a retry after a lost answer
  // replays instead of recording the check twice.
  const paymentId = useRef<string>(crypto.randomUUID());
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    loadResidents(facilityId)
      .then((rows) => { if (active) { setResidents(rows); setResidentsError(false); } })
      .catch(() => { if (active) setResidentsError(true); });
    return () => { active = false; };
  }, [open, facilityId, loadResidents]);

  function reset() {
    paymentId.current = crypto.randomUUID();
    setResidentId(""); setAmount(""); setMethod("check"); setReference(""); setPayerName("");
    setPaymentDate(localDate); setPhoto(null); setReasonAsked(null); setReason(""); setError(null); setDone(null);
  }

  const cents = dollarsToCents(amount);
  const ready = Boolean(residentId && cents && photo && paymentDate && (!reasonAsked || reason.trim()));

  async function submit() {
    if (!ready || !cents || !photo || busy) return;
    setBusy(true);
    setError(null);
    const outcome = await record(createClient(), {
      paymentId: paymentId.current, facilityId, residentId, paymentDate, amountCents: cents, method,
      reference, payerName, mismatchReason: reason, note: "", photo,
    });
    setBusy(false);
    if (outcome.kind === "recorded") {
      setDone(outcome);
      onRecorded?.();
    } else if (outcome.kind === "reason_required") {
      setReasonAsked(outcome.message);
      requestAnimationFrame(() => reasonRef.current?.focus());
    } else {
      setError(outcome.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-[480px]" data-testid="record-payment-dialog">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Applied to the resident’s oldest open invoice first. A photo of the check or confirmation is required.</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-2 text-[13px]" role="status">
            <p className="font-medium text-foreground">{done.replayed ? "Already recorded." : "Payment recorded."}</p>
            <p className="text-muted-foreground">
              {formatCents(done.allocatedCents)} applied to the oldest open invoice
              {done.unappliedCents > 0 ? `; ${formatCents(done.unappliedCents)} is held on the account, not yet applied to an invoice.` : "."}
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={reset}>Record another</Button>
              <Button type="button" onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="grid gap-3" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <div className="grid gap-1">
              <Label htmlFor={`${ids}-resident`}>Resident</Label>
              {residentsError ? (
                <p role="alert" className="text-xs text-destructive">Residents could not be loaded. Close and try again.</p>
              ) : (
                <select id={`${ids}-resident`} className={FIELD} value={residentId} onChange={(e) => { setResidentId(e.target.value); setReasonAsked(null); }} disabled={!residents} required>
                  <option value="">{residents ? "Choose a resident" : "Loading…"}</option>
                  {residents?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-amount`}>Amount</Label>
                <Input id={`${ids}-amount`} inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setReasonAsked(null); }} aria-invalid={amount !== "" && !cents} required />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-method`}>Method</Label>
                <select id={`${ids}-method`} className={FIELD} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-reference`}>{method === "check" ? "Check number" : "Reference"}</Label>
                <Input id={`${ids}-reference`} value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-date`}>Received</Label>
                <Input id={`${ids}-date`} type="date" value={paymentDate} max={localDate} onChange={(e) => setPaymentDate(e.target.value)} required />
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${ids}-payer`}>Paid by (optional)</Label>
              <Input id={`${ids}-payer`} value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="Name on the check" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${ids}-photo`}>Photo of the check or confirmation</Label>
              <input
                id={`${ids}-photo`}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="text-[13px]"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                required
              />
            </div>
            {reasonAsked ? (
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-reason`}>{reasonAsked}</Label>
                <textarea
                  ref={reasonRef}
                  id={`${ids}-reason`}
                  className="min-h-16 rounded-md border border-border bg-background px-2.5 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Partial payment — family paying the rest on the 15th."
                  required
                />
              </div>
            ) : null}
            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={!ready || busy}>{busy ? "Recording…" : "Record payment"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
