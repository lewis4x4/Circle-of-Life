"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { enumLabel } from "@/lib/display/enum-label";
import {
  ESCALATION_CHANNELS,
  ESCALATION_ROLES,
  blankEscalationStep,
  moveEscalationStep,
  removeEscalationStep,
  type EscalationStepDraft,
} from "@/lib/operations/escalation-step-editor";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

/** Escalation ladder as rows: who, how, after how many minutes (COL-689). */
export function EscalationStepEditor({
  steps,
  onChange,
  disabled = false,
}: {
  steps: EscalationStepDraft[];
  onChange: (steps: EscalationStepDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<EscalationStepDraft>) =>
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));

  return (
    <div className="space-y-3">
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No escalation. The task stays with its assignee until it is done.</p>
      ) : (
        <ol className="space-y-3">
          {steps.map((step, index) => {
            const n = index + 1;
            const roleKnown = ESCALATION_ROLES.includes(step.role);
            const channelKnown = ESCALATION_CHANNELS.some((c) => c.value === step.channel);
            return (
              <li key={index} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">Step {n}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move step ${n} up`}
                      disabled={disabled || index === 0}
                      onClick={() => onChange(moveEscalationStep(steps, index, -1))}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move step ${n} down`}
                      disabled={disabled || index === steps.length - 1}
                      onClick={() => onChange(moveEscalationStep(steps, index, 1))}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove step ${n}`}
                      disabled={disabled}
                      onClick={() => onChange(removeEscalationStep(steps, index))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_8rem_auto] md:items-end">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Escalate to</span>
                    <select
                      aria-label={`Step ${n} escalates to`}
                      className={selectClass}
                      value={step.role}
                      disabled={disabled}
                      onChange={(event) => update(index, { role: event.target.value })}
                    >
                      <option value="" disabled>
                        Select a role…
                      </option>
                      {!roleKnown && step.role ? <option value={step.role}>{enumLabel(step.role)}</option> : null}
                      {ESCALATION_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {enumLabel(role)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Reach them by</span>
                    <select
                      aria-label={`Step ${n} channel`}
                      className={selectClass}
                      value={step.channel}
                      disabled={disabled}
                      onChange={(event) => update(index, { channel: event.target.value })}
                    >
                      {!channelKnown && step.channel ? <option value={step.channel}>{enumLabel(step.channel)}</option> : null}
                      {ESCALATION_CHANNELS.map((channel) => (
                        <option key={channel.value} value={channel.value}>
                          {channel.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>After (minutes)</span>
                    <Input
                      aria-label={`Step ${n} minutes to wait`}
                      inputMode="numeric"
                      value={step.sla_minutes}
                      disabled={disabled}
                      onChange={(event) => update(index, { sla_minutes: event.target.value })}
                      placeholder="e.g. 30"
                    />
                  </label>
                  <label className="flex h-10 items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      aria-label={`Step ${n} on`}
                      checked={step.enabled}
                      disabled={disabled}
                      onCheckedChange={(checked) => update(index, { enabled: checked })}
                    />
                    <span>On</span>
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...steps, blankEscalationStep()])}
      >
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        Add step
      </Button>
    </div>
  );
}
