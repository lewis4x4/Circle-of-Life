"use client";

/**
 * Facility floor tablet settings (COL-690, spec 40 §1): how long a floor
 * tablet waits before it locks, and which login roles its roster lists when a
 * tablet has no roles of its own. Configuration, never code.
 */

import React, { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { RecordDetailSection } from "@/design-system/components/record-detail";
import {
  FLOOR_IDLE_LOCK_MAX,
  FLOOR_IDLE_LOCK_MIN,
  isValidIdleLockMinutes,
  isValidRosterRoles,
  rosterRolesLabel,
  type FloorSettings,
} from "@/lib/timeclock/floor-settings";

import { TimeclockRosterRolePicker } from "./TimeclockRosterRolePicker";

export type TimeclockFloorSettingsProps = {
  settings: FloorSettings;
  canManage: boolean;
  busy: boolean;
  onSave: (next: FloorSettings) => Promise<boolean>;
};

export function TimeclockFloorSettings({ settings, canManage, busy, onSave }: TimeclockFloorSettingsProps) {
  const [minutes, setMinutes] = useState(String(settings.idle_lock_minutes));
  const [roles, setRoles] = useState<string[]>(settings.roster_roles);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMinutes(String(settings.idle_lock_minutes));
    setRoles(settings.roster_roles);
  }, [settings]);

  const minutesNumber = Number(minutes);
  const valid = isValidIdleLockMinutes(minutesNumber) && isValidRosterRoles(roles);

  const save = async () => {
    setSaved(false);
    if (!valid) return;
    const ok = await onSave({ idle_lock_minutes: minutesNumber, roster_roles: roles });
    setSaved(ok);
  };

  return (
    <RecordDetailSection
      title="Floor tablets"
      description="A floor tablet lists the staff clocked in at the front door. Each person unlocks it with their timeclock PIN."
    >
      {canManage ? (
        <div className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Lock after this many idle minutes</span>
            <input
              type="number"
              inputMode="numeric"
              min={FLOOR_IDLE_LOCK_MIN}
              max={FLOOR_IDLE_LOCK_MAX}
              value={minutes}
              disabled={busy}
              onChange={(event) => {
                setSaved(false);
                setMinutes(event.target.value);
              }}
              className="block h-11 w-28 rounded-[8px] border border-input bg-background px-3 tabular-nums"
            />
            <span className="block text-xs text-muted-foreground">
              {FLOOR_IDLE_LOCK_MIN} to {FLOOR_IDLE_LOCK_MAX} minutes.
            </span>
          </label>
          <TimeclockRosterRolePicker
            legend="Roles listed on floor tablets"
            value={roles}
            disabled={busy}
            onChange={(next) => {
              setSaved(false);
              setRoles(next);
            }}
          />
          {!valid ? <p className="text-xs text-destructive">Choose at least one role and 1 to 30 minutes.</p> : null}
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" disabled={busy || !valid} onClick={() => void save()}>
              Save floor settings
            </Button>
            {saved ? (
              <p role="status" className="text-xs text-muted-foreground">
                Saved.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4" data-testid="floor-settings-summary">
          <dt className="text-muted-foreground">Idle lock</dt>
          <dd className="tabular-nums">{settings.idle_lock_minutes} min</dd>
          <dt className="text-muted-foreground">Roles listed</dt>
          <dd>{rosterRolesLabel(settings.roster_roles)}</dd>
        </dl>
      )}
    </RecordDetailSection>
  );
}
