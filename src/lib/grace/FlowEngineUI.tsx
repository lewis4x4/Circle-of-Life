"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { graceExecuteFlowStep } from "./api";
import { computeGraceFlowTotalCents, useGraceStore } from "./store";
import type { GraceSlotDefinition } from "./types";

function renderSlotControl(
  slot: GraceSlotDefinition,
  value: unknown,
  onChange: (value: unknown) => void,
) {
  if (slot.type === "longtext") {
    return (
      <Textarea
        value={typeof value === "string" ? value : ""}
        placeholder={slot.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (slot.type === "choice") {
    return (
      <div className="grid gap-2">
        {slot.choices?.map((choice) => (
          <Button
            key={choice.value}
            variant={value === choice.value ? "default" : "outline"}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <Input
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      type={slot.type === "number" || slot.type === "currency" ? "number" : "text"}
      placeholder={slot.placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function FlowEngineUI() {
  const {
    state,
    setSlot,
    advanceSlot,
    backSlot,
    cancelFlow,
    setError,
    setTotalCents,
    flowSucceeded,
  } = useGraceStore();
  const [submitting, setSubmitting] = useState(false);
  const flow = state.activeFlow;

  const slotSchema = useMemo(
    () => flow?.flow.grace_metadata?.slot_schema ?? [],
    [flow],
  );

  if (!flow) return null;

  const currentSlot = slotSchema[flow.current_slot_index];
  const isReviewStep = !currentSlot;

  const handleExecute = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const totalCents = computeGraceFlowTotalCents(flow.slot_values);
      setTotalCents(totalCents);
      const result = await graceExecuteFlowStep({
        flow_id: flow.flow.id,
        conversation_id: flow.conversation_id,
        idempotency_key: flow.idempotency_key,
        slots: flow.slot_values,
        high_value_confirmation_cents: flow.high_value_confirmation_cents,
        client_slot_updated_at: flow.client_slot_updated_at,
      });
      if (!result.ok) {
        throw new Error(result.message ?? result.error ?? "Grace flow execution failed");
      }
      flowSucceeded({
        run_id: result.run_id ?? crypto.randomUUID(),
        flow_label: flow.flow.name,
        flow_slug: flow.flow.slug,
        result: result.result ?? {},
        expires_at: result.undo_deadline ? new Date(result.undo_deadline).getTime() : Date.now() + 60_000,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Grace flow execution failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && cancelFlow()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{flow.flow.name}</DialogTitle>
          <DialogDescription>{flow.flow.description ?? "Complete the requested Grace action."}</DialogDescription>
        </DialogHeader>

        {state.errorBanner ? (
          <div className="rounded-xl border border-rose-300/50 bg-rose-50/80 p-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
            {state.errorBanner}
          </div>
        ) : null}

        {!isReviewStep && currentSlot ? (
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-sm font-medium">{currentSlot.label}</div>
              {renderSlotControl(currentSlot, flow.slot_values[currentSlot.id], (nextValue) =>
                setSlot(currentSlot.id, nextValue),
              )}
              {currentSlot.helper_text ? (
                <p className="mt-2 text-xs text-muted-foreground">{currentSlot.helper_text}</p>
              ) : null}
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={flow.current_slot_index === 0 ? cancelFlow : backSlot}>
                {flow.current_slot_index === 0 ? "Cancel" : "Back"}
              </Button>
              <Button onClick={advanceSlot}>
                Next
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="mb-3 text-sm font-semibold">Review</div>
              <div className="space-y-2 text-sm">
                {slotSchema.map((slot) => (
                  <div key={slot.id} className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">{slot.label}</span>
                    <span className="max-w-[60%] text-right">
                      {String(flow.slot_values[slot.id] ?? "—")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={backSlot}>
                Back
              </Button>
              <Button onClick={handleExecute} disabled={submitting}>
                {submitting ? "Running..." : "Run Grace action"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
