"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { MonitoringOrderForm } from "@/components/rounding/MonitoringOrderForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { facilityDatetimeLocalToUtcIso, nowFacilityDatetimeLocal } from "@/lib/facility-wall-clock";
import {
  emptyMonitoringOrderDraft,
  validateMonitoringOrderDraft,
  type IntervalOptions,
  type MonitoringOrderDraft,
} from "@/lib/rounding/monitoring-orders";
import { createClient } from "@/lib/supabase/client";

type IntervalOptionRow = {
  preset_minutes: number[] | null;
  min_minutes: number | null;
  max_minutes: number | null;
};

/**
 * Monitoring Order entry, on the resident record where the paperwork is.
 *
 * A caregiver holding discharge instructions at 21:00 opens the resident and
 * keys it in. The order is in force the moment it saves: there is no approval
 * step, no queue and nothing to wait for. The facility administrator and the
 * standing alert audience are notified by the command, not asked.
 */
export function MonitoringOrderAction({
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
  const [options, setOptions] = useState<IntervalOptions | null>(null);
  const [draft, setDraft] = useState<MonitoringOrderDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const loadOptions = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("monitoring_order_interval_options" as never);
    if (error) {
      setProblems(["Could not load the interval choices. Close this and open it again."]);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as IntervalOptionRow | null;
    if (!row?.preset_minutes || row.min_minutes == null || row.max_minutes == null) {
      setProblems(["The interval choices are not configured for this organization yet."]);
      return;
    }
    setOptions({
      presetMinutes: row.preset_minutes,
      minMinutes: row.min_minutes,
      maxMinutes: row.max_minutes,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setProblems([]);
    // The start time is the one field that arrives filled in, because the order
    // is already in force when somebody is keying it in.
    setDraft(emptyMonitoringOrderDraft(nowFacilityDatetimeLocal()));
    void loadOptions();
  }, [open, loadOptions]);

  async function save() {
    if (!draft || !options) return;
    const found = validateMonitoringOrderDraft(draft, options);
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    setSaving(true);
    setProblems([]);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("create_monitoring_order" as never, {
        p_resident_id: residentId,
        p_interval_minutes: draft.intervalMinutes,
        p_ordered_by_type: draft.orderedByType,
        p_ordered_by_name: draft.orderedByName.trim(),
        p_order_received_as: draft.orderReceivedAs,
        p_reason_category: draft.reasonCategory,
        p_reason_note: draft.reasonNote.trim(),
        p_starts_at: facilityDatetimeLocalToUtcIso(draft.startsAt),
        p_ends_at: draft.endsAt.trim().length > 0 ? facilityDatetimeLocalToUtcIso(draft.endsAt) : null,
        p_review_due_at:
          draft.reviewDueAt.trim().length > 0 ? facilityDatetimeLocalToUtcIso(draft.reviewDueAt) : null,
      } as never);
      if (error) throw new Error(error.message);
      toast.success("Monitoring Order in force. The administrator has been notified.");
      setOpen(false);
      onDone?.();
    } catch (cause) {
      setProblems([
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "Could not enter the Monitoring Order. Try again.",
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
        className="min-h-[44px] text-[12px]"
        onClick={() => setOpen(true)}
      >
        Monitoring Order
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (saving) return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Monitoring Order for {residentName}</DialogTitle>
            <DialogDescription>
              Check this resident more often than the facility cadence, for a stated reason, from a
              named ordering party. It takes effect as soon as you save it.
            </DialogDescription>
          </DialogHeader>

          {draft && options ? (
            <MonitoringOrderForm
              draft={draft}
              onChange={setDraft}
              options={options}
              disabled={saving}
            />
          ) : problems.length === 0 ? (
            <div className="space-y-1 py-6 text-sm">
              <p className="font-medium text-foreground">Loading the interval choices</p>
              <p className="text-muted-foreground">They come from this organization&apos;s settings.</p>
            </div>
          ) : null}

          {problems.length > 0 ? (
            <ul role="alert" className="space-y-1 rounded-[8px] border border-destructive p-3 text-sm">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={saving || !draft || !options} onClick={() => void save()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start Monitoring Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default MonitoringOrderAction;
