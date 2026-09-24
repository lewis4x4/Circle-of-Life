"use client";

import React from "react";

import { FLOOR_ROSTER_ROLE_OPTIONS } from "@/lib/timeclock/floor-settings";

export type TimeclockRosterRolePickerProps = {
  legend: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/** Checkbox list of the staff login roles a floor tablet may list (spec 40 §1 "Roster roles"). */
export function TimeclockRosterRolePicker({ legend, value, onChange, disabled }: TimeclockRosterRolePickerProps) {
  const selected = new Set(value);
  const toggle = (role: string) => {
    const next = new Set(selected);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    onChange(FLOOR_ROSTER_ROLE_OPTIONS.map((option) => option.value).filter((option) => next.has(option)));
  };
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {FLOOR_ROSTER_ROLE_OPTIONS.map((option) => (
          <label key={option.value} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={selected.has(option.value)}
              onChange={() => toggle(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
