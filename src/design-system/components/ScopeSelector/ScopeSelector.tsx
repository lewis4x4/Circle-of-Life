"use client";

import { useMemo } from "react";

import { useScope, type Scope } from "@/lib/scope";
import { cn } from "@/lib/utils";

export type ScopeOption = { id: string; label: string };
export type GroupOption = ScopeOption & { ownerId?: string };
export type FacilityOption = ScopeOption & { groupId?: string; ownerId?: string };

export type ScopeSelectorProps = {
  owners: ScopeOption[];
  groups: GroupOption[];
  facilities: FacilityOption[];
  className?: string;
  scopeOverride?: Scope;
  onChange?: (partial: Partial<Scope>) => void;
};

export function ScopeSelector({
  owners,
  groups,
  facilities,
  className,
  scopeOverride,
  onChange,
}: ScopeSelectorProps) {
  const [urlScope, setUrlScope] = useScope();
  const scope = scopeOverride ?? urlScope;
  const setScope = onChange ?? setUrlScope;

  const filteredGroups = useMemo(
    () => (scope.ownerId ? groups.filter((g) => !g.ownerId || g.ownerId === scope.ownerId) : groups),
    [groups, scope.ownerId],
  );

  const filteredFacilities = useMemo(() => {
    let list = facilities;
    if (scope.ownerId) list = list.filter((f) => !f.ownerId || f.ownerId === scope.ownerId);
    if (scope.groupId) list = list.filter((f) => !f.groupId || f.groupId === scope.groupId);
    return list;
  }, [facilities, scope.groupId, scope.ownerId]);

  const selectedFacilityIds = new Set(scope.facilityIds ?? []);
  const selectedCount = selectedFacilityIds.size;

  return (
    <div
      role="group"
      aria-label="Scope selector"
      className={cn(
        "flex flex-wrap items-end gap-3",
        className,
      )}
    >
      <SelectField
        label="Owner"
        id="ui-v2-scope-owner"
        value={scope.ownerId ?? ""}
        options={owners}
        onChange={(value) => setScope({ ownerId: value || undefined })}
      />
      <SelectField
        label="Group"
        id="ui-v2-scope-group"
        value={scope.groupId ?? ""}
        options={filteredGroups}
        onChange={(value) => setScope({ groupId: value || undefined })}
        disabled={filteredGroups.length === 0}
      />

      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="text-xs font-semibold uppercase tracking-caps text-text-muted">
          Facility
        </legend>
        <div
          aria-label="Facility options"
          className="flex max-h-40 flex-wrap items-start gap-2 overflow-auto rounded-sm border border-border bg-surface p-2"
        >
          {filteredFacilities.length === 0 ? (
            <span className="text-xs text-text-muted">No facilities in scope</span>
          ) : (
            filteredFacilities.map((facility) => {
              const checked = selectedFacilityIds.has(facility.id);
              return (
                <label
                  key={facility.id}
                  className={cn(
                    "flex items-center gap-2 rounded-sm border px-2 py-1 text-xs font-medium",
                    checked
                      ? "border-brand-primary bg-surface-elevated text-text-primary"
                      : "border-border bg-surface text-text-secondary",
                  )}
                >
                  <input
                    type="checkbox"
                    name="facility"
                    value={facility.id}
                    checked={checked}
                    onChange={(event) => {
                      const nextSet = new Set(selectedFacilityIds);
                      if (event.target.checked) nextSet.add(facility.id);
                      else nextSet.delete(facility.id);
                      setScope({
                        facilityIds: nextSet.size > 0 ? Array.from(nextSet) : undefined,
                      });
                    }}
                    className="h-3 w-3 accent-brand-primary"
                  />
                  {facility.label}
                </label>
              );
            })
          )}
        </div>
        <p className="text-xs text-text-muted" aria-live="polite">
          {selectedCount === 0
            ? "All facilities in scope"
            : `${selectedCount} ${selectedCount === 1 ? "facility" : "facilities"} selected`}
        </p>
      </fieldset>
    </div>
  );
}

type SelectFieldProps = {
  label: string;
  id: string;
  value: string;
  options: ScopeOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

function SelectField({ label, id, value, options, onChange, disabled }: SelectFieldProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-caps text-text-muted"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-44 rounded-sm border border-border bg-surface px-2 text-sm text-text-primary focus-visible:border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">All {label.toLowerCase()}s</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
