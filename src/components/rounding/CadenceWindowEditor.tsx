"use client";

/**
 * Tier 2: editing one observation window. Spec 25A section 6.2 and 6.13.
 *
 * Due time is two numeric fields rather than a browser time control, for the
 * same reason the constitution rejects the native date control: the native one
 * renders differently on every platform and cannot be made to match anything
 * else on the page.
 *
 * Grace before carries the one sided rule as helper text rather than as a
 * silent clamp. Spec 6.5 block 3 refuses a non zero grace before on a window
 * due at a shift start, and it refuses it in the database; saying so here means
 * an administrator finds out while they are typing rather than on submit.
 */

import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  joinLocalTime,
  splitLocalTime,
  type CadenceShift,
  type WindowDraft,
} from "@/lib/rounding/cadence-settings";

const LAST_HOUR_OF_DAY = 23;
const LAST_MINUTE_OF_HOUR = 59;

export function CadenceWindowEditor({
  draft,
  shifts,
  onChange,
  disabled,
}: {
  draft: WindowDraft;
  shifts: CadenceShift[];
  onChange: (next: WindowDraft) => void;
  disabled?: boolean;
}) {
  const { hour, minute } = splitLocalTime(draft.due_at_local);
  const shift = shifts.find((candidate) => candidate.shift_key === draft.shift_key) ?? null;
  const dueIsShiftStart = shifts.some((candidate) => candidate.starts_at_local === draft.due_at_local);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-2">
        <FormLabel htmlFor={`window-label-${draft.window_key}`} required>
          What staff see this check called
        </FormLabel>
        <Input
          id={`window-label-${draft.window_key}`}
          value={draft.label}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
        />
      </div>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-[13px] font-medium text-foreground">Due at, building local time</legend>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <FormLabel htmlFor={`window-hour-${draft.window_key}`}>Hour</FormLabel>
            <NumberInput
              aria-label="Due hour"
              value={hour}
              min={0}
              max={LAST_HOUR_OF_DAY}
              disabled={disabled}
              onValueChange={(next) => onChange({ ...draft, due_at_local: joinLocalTime(next, minute) })}
            />
          </div>
          <div className="space-y-1">
            <FormLabel htmlFor={`window-minute-${draft.window_key}`}>Minute</FormLabel>
            <NumberInput
              aria-label="Due minute"
              value={minute}
              min={0}
              max={LAST_MINUTE_OF_HOUR}
              step={5}
              disabled={disabled}
              onValueChange={(next) => onChange({ ...draft, due_at_local: joinLocalTime(hour, next) })}
            />
          </div>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <FormLabel htmlFor={`window-grace-before-${draft.window_key}`}>Opens this many minutes early</FormLabel>
          <NumberInput
            aria-label="Grace before, in minutes"
            value={draft.grace_before_minutes}
            min={0}
            step={5}
            disabled={disabled}
            onValueChange={(next) => onChange({ ...draft, grace_before_minutes: next })}
          />
          {dueIsShiftStart ? (
            <p className="text-[13px] text-muted-foreground">
              This check is due at the start of a shift, so it has to open at zero minutes early. The incoming
              shift is the one that has to lay eyes on the resident, and any early opening lets the outgoing
              shift clear it first.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <FormLabel htmlFor={`window-grace-after-${draft.window_key}`}>Stays open this many minutes after</FormLabel>
          <NumberInput
            aria-label="Grace after, in minutes"
            value={draft.grace_after_minutes}
            min={0}
            step={5}
            disabled={disabled}
            onValueChange={(next) => onChange({ ...draft, grace_after_minutes: next })}
          />
          <p className="text-[13px] text-muted-foreground">
            The escalation ladder is measured from the moment this window closes, so widening it moves every step
            with it.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <FormLabel htmlFor={`window-shift-${draft.window_key}`} required>
          Which shift owns it
        </FormLabel>
        <Select
          value={draft.shift_key}
          disabled={disabled}
          onValueChange={(next) => onChange({ ...draft, shift_key: next })}
        >
          <SelectTrigger id={`window-shift-${draft.window_key}`}>
            <SelectValue placeholder="Choose a shift" />
          </SelectTrigger>
          <SelectContent>
            {shifts.map((candidate) => (
              <SelectItem key={candidate.shift_key} value={candidate.shift_key}>
                {candidate.label} ({candidate.starts_at_local} to {candidate.ends_at_local})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {shift == null ? (
          <p className="text-[13px] text-warning">
            This check is assigned to a shift this building does not run, so nothing will generate it.
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-[13px] font-medium text-foreground">This check runs</p>
          <p className="text-[13px] text-muted-foreground">
            Turning it off removes it from every resident&apos;s day. Every shift the building runs has to keep at
            least one check.
          </p>
        </div>
        <Switch
          checked={draft.enabled}
          disabled={disabled}
          aria-label="This check runs"
          onCheckedChange={(next) => onChange({ ...draft, enabled: next })}
        />
      </div>
    </div>
  );
}
