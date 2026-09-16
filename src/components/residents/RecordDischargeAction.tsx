"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  DISCHARGE_REASONS,
  dischargeReasonLabel,
  officialDischargePatch,
  officialDischargeReceipt,
  validateOfficialDischarge,
  type DischargeReason,
} from "@/lib/residents/official-discharge";

/**
 * Record discharge — on the resident record, where a move-out is noticed.
 *
 * This is the action that frees a bed (COL-418). It used to exist only inside
 * the discharge medication-reconciliation screen, which is held back from staff
 * menus for the first rollout, so a resident could move out with no reachable
 * way to say so and the bed stayed spoken for.
 *
 * Deliberately a confirm step rather than a one-click chip: it ends a residency,
 * sets the billing cutoff and releases the bed. The date is never pre-filled —
 * an assumed "today" would be the form choosing a billing date for the
 * administrator.
 */
export function RecordDischargeAction({
  residentId,
  residentName,
  onDone,
}: {
  residentId: string;
  residentName: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState<DischargeReason | "">("");
  const [destination, setDestination] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  function reset() {
    setDate("");
    setReason("");
    setDestination("");
    setProblems([]);
  }

  async function record() {
    const found = validateOfficialDischarge({ date, reason });
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    setSaving(true);
    setProblems([]);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Session expired. Sign in again to record a discharge.");
        return;
      }
      const { error } = await supabase
        .from("residents")
        .update(
          officialDischargePatch({
            reason: reason as DischargeReason,
            date,
            destination,
            actorId: user.id,
          }) as never,
        )
        .eq("id", residentId);
      if (error) throw error;
      toast.success(officialDischargeReceipt(reason as DischargeReason));
      setOpen(false);
      reset();
      onDone?.();
    } catch (cause) {
      setProblems([
        cause instanceof Error ? cause.message : "Could not record the discharge. Try again.",
      ]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-[12px]"
        onClick={() => setOpen(true)}
      >
        Record discharge
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (saving) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record discharge — {residentName}</DialogTitle>
            <DialogDescription>
              Use this when belongings are out and the resident is off census. It sets the billing
              cutoff and releases the bed. Medication reconciliation is a separate clinical task and
              is not required first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <label className="block space-y-1.5">
              <span className="block font-medium">Date belongings were removed</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label="Date belongings were removed"
                className="w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="block text-xs text-muted-foreground">
                Billing stops on this date. It is not filled in for you.
              </span>
            </label>
            <label className="block space-y-1.5">
              <span className="block font-medium">Discharge reason</span>
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value as DischargeReason | "")}
                aria-label="Discharge reason"
                className="w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Choose a reason</option>
                {DISCHARGE_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {dischargeReasonLabel(value)}
                  </option>
                ))}
              </select>
              {reason === "death" ? (
                <span className="block text-xs text-muted-foreground">
                  Recorded as deceased rather than discharged.
                </span>
              ) : null}
            </label>
            <label className="block space-y-1.5">
              <span className="block font-medium">Destination</span>
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                aria-label="Destination"
                placeholder="Home, another ALF, hospital"
                className="w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="block text-xs text-muted-foreground">Optional.</span>
            </label>
            {problems.length > 0 ? (
              <ul role="alert" className="space-y-1 rounded-[8px] border border-destructive p-3 text-sm">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void record()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record discharge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default RecordDischargeAction;
