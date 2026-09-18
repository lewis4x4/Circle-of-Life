"use client";

/**
 * Tier 2: editing one escalation rung. Spec 25A section 6.2 and 6.9.
 *
 * Offsets are minutes from window close and are stored signed, so a step that
 * fires before the window shuts carries a negative offset. The form shows the
 * sign as two choices rather than asking for a minus, because "so many minutes
 * before it closes" is what an administrator means and a negative number is
 * what the row holds.
 *
 * Recipients are roles. There is deliberately no field for a person, an email
 * address or a phone number: roles resolve through the notification routes at
 * delivery time, so somebody leaving does not silently break the ladder.
 *
 * The final step's existence cannot be turned off, only rewritten. Spec 6.5
 * block 5 refuses it in the database, and the control is disabled here so an
 * administrator does not discover that on submit.
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
import type { LadderRung, RungDraft } from "@/lib/rounding/cadence-settings";
import { channelLabel, staffRoleLabel } from "@/lib/rounding/cadence-settings-copy";

const BEFORE = "before";
const AFTER = "after";

export function CadenceRungEditor({
  draft,
  channels,
  roles,
  onChange,
  disabled,
}: {
  draft: RungDraft;
  /** The channels this building already uses, read from the rungs in force. */
  channels: string[];
  /** The roles this building already targets, with how many people hold each. */
  roles: LadderRung["roles"];
  onChange: (next: RungDraft) => void;
  disabled?: boolean;
}) {
  const direction = draft.offset_minutes < 0 ? BEFORE : AFTER;
  const magnitude = Math.abs(draft.offset_minutes);

  function setOffset(nextDirection: string, nextMagnitude: number) {
    onChange({
      ...draft,
      offset_minutes: nextDirection === BEFORE ? -Math.abs(nextMagnitude) : Math.abs(nextMagnitude),
    });
  }

  function toggleRole(role: string, on: boolean) {
    const next = on
      ? Array.from(new Set([...draft.target_staff_roles, role]))
      : draft.target_staff_roles.filter((candidate) => candidate !== role);
    onChange({ ...draft, target_staff_roles: next });
  }

  function toggleChannel(channel: string, on: boolean) {
    const next = on
      ? Array.from(new Set([...draft.channels, channel]))
      : draft.channels.filter((candidate) => candidate !== channel);
    onChange({ ...draft, channels: next });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-2">
        <FormLabel htmlFor={`rung-label-${draft.rung_key}`} required>
          What this step is called
        </FormLabel>
        <Input
          id={`rung-label-${draft.rung_key}`}
          value={draft.label}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
        />
      </div>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-[13px] font-medium text-foreground">When it fires</legend>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <FormLabel htmlFor={`rung-offset-${draft.rung_key}`}>Minutes</FormLabel>
            <NumberInput
              aria-label="Minutes from the window closing"
              value={magnitude}
              min={0}
              step={5}
              disabled={disabled}
              onValueChange={(next) => setOffset(direction, next)}
            />
          </div>
          <div className="min-w-[13rem] space-y-1">
            <FormLabel htmlFor={`rung-direction-${draft.rung_key}`}>Relative to the window closing</FormLabel>
            <Select value={direction} disabled={disabled} onValueChange={(next) => setOffset(next, magnitude)}>
              <SelectTrigger id={`rung-direction-${draft.rung_key}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BEFORE}>before it closes</SelectItem>
                <SelectItem value={AFTER}>after it closes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Every step is measured from the moment the check&apos;s window shuts, so widening a check&apos;s grace moves
          this step with it. Steps have to run in order: each one later than the one before it.
        </p>
      </fieldset>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-[13px] font-medium text-foreground">Who hears about it</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {roles.map((role) => (
            <label key={role.staff_role} className="flex items-center gap-2 text-[13px] text-foreground">
              <Switch
                checked={draft.target_staff_roles.includes(role.staff_role)}
                disabled={disabled}
                aria-label={staffRoleLabel(role.staff_role)}
                onCheckedChange={(on) => toggleRole(role.staff_role, on)}
              />
              <span>
                {staffRoleLabel(role.staff_role)}
                <span className={role.holder_count === 0 ? "ml-1 text-warning" : "ml-1 text-muted-foreground"}>
                  ({role.holder_count} here now)
                </span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-foreground">
          <Switch
            checked={draft.include_assigned_staff}
            disabled={disabled || draft.assigned_staff_only}
            aria-label="The staff member the check belongs to"
            onCheckedChange={(on) => onChange({ ...draft, include_assigned_staff: on })}
          />
          <span>The staff member the check belongs to</span>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-foreground">
          <Switch
            checked={draft.use_standing_alert_routes}
            disabled={disabled}
            aria-label="The building's standing alert audience"
            onCheckedChange={(on) => onChange({ ...draft, use_standing_alert_routes: on })}
          />
          <span>The building&apos;s standing alert audience</span>
        </label>
        <p className="text-[13px] text-muted-foreground">
          Roles, never a named person and never an email address, so somebody leaving does not quietly break this
          step. A step has to reach somebody.
        </p>
      </fieldset>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-[13px] font-medium text-foreground">How it reaches them</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {channels.map((channel) => (
            <label key={channel} className="flex items-center gap-2 text-[13px] text-foreground">
              <Switch
                checked={draft.channels.includes(channel)}
                disabled={disabled}
                aria-label={channelLabel(channel)}
                onCheckedChange={(on) => toggleChannel(channel, on)}
              />
              <span>{channelLabel(channel)}</span>
            </label>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">
          The overnight mix is worth setting separately. A loud step every night gets the whole channel muted
          inside a week, and once it is muted the steps that matter are muted with it.
        </p>
      </fieldset>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-[13px] font-medium text-foreground">This step runs</p>
          <p className="text-[13px] text-muted-foreground">
            {draft.is_terminal
              ? "The final step cannot be turned off. Its wording and its timing are yours to change; its existence is not."
              : "Turning a step off removes it from the ladder. The steps after it still fire."}
          </p>
        </div>
        <Switch
          checked={draft.enabled}
          disabled={disabled || draft.is_terminal}
          aria-label="This step runs"
          onCheckedChange={(next) => onChange({ ...draft, enabled: next })}
        />
      </div>
    </div>
  );
}
