"use client";

/**
 * Per floor tablet roster roles (COL-690): a tablet either follows the facility
 * default or lists its own roles. Owner and org_admin only.
 */

import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { rosterRolesLabel } from "@/lib/timeclock/floor-settings";

import { TimeclockRosterRolePicker } from "./TimeclockRosterRolePicker";

export type TimeclockDeviceRosterRolesProps = {
  deviceLabel: string;
  rosterRoles: string[] | null;
  facilityDefault: string[];
  canManage: boolean;
  busy: boolean;
  onSave: (rosterRoles: string[] | null) => Promise<boolean>;
};

export function TimeclockDeviceRosterRoles({ deviceLabel, rosterRoles, facilityDefault, canManage, busy, onSave }: TimeclockDeviceRosterRolesProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(rosterRoles ?? facilityDefault);

  const summary = rosterRoles ? rosterRolesLabel(rosterRoles) : `Facility default (${rosterRolesLabel(facilityDefault)})`;

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{summary}</span>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            aria-label={`Change roles for ${deviceLabel}`}
            onClick={() => {
              setDraft(rosterRoles ?? facilityDefault);
              setEditing(true);
            }}
          >
            Change roles
          </Button>
        ) : null}
      </div>
    );
  }

  const save = async (next: string[] | null) => {
    if (await onSave(next)) setEditing(false);
  };

  return (
    <div className="space-y-3 rounded-[8px] border border-border bg-muted/40 p-3">
      <TimeclockRosterRolePicker legend={`Roles listed on ${deviceLabel}`} value={draft} disabled={busy} onChange={setDraft} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy || draft.length === 0} onClick={() => void save(draft)}>
          Save roles
        </Button>
        {rosterRoles ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void save(null)}>
            Use facility default
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
