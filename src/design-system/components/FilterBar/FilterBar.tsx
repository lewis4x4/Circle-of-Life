"use client";

import { useCallback, useState } from "react";

import { useScope, type Scope } from "@/lib/scope";
import { cn } from "@/lib/utils";

export type FilterBarOption = { id: string; label: string };

export type FilterBarProps = {
  dashboardId: string;
  facilities?: FilterBarOption[];
  regions?: FilterBarOption[];
  statuses?: FilterBarOption[];
  savedViews?: Array<{ id: string; name: string }>;
  scopeOverride?: Scope;
  onScopeChange?: (partial: Partial<Scope>) => void;
  selectedStatusIds?: string[];
  onStatusChange?: (ids: string[]) => void;
  selectedRegionId?: string;
  onRegionChange?: (id: string | undefined) => void;
  onReset?: () => void;
  className?: string;
};

type SaveViewResult = { success: true; savedViewId: string };

export function FilterBar({
  dashboardId,
  facilities = [],
  regions = [],
  statuses = [],
  savedViews = [],
  scopeOverride,
  onScopeChange,
  selectedStatusIds = [],
  onStatusChange,
  selectedRegionId,
  onRegionChange,
  onReset,
  className,
}: FilterBarProps) {
  const [urlScope, setUrlScope] = useScope();
  const scope = scopeOverride ?? urlScope;
  const setScope = onScopeChange ?? setUrlScope;

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  const hasActiveFilters =
    Boolean(scope.dateRange?.start || scope.dateRange?.end) ||
    (scope.facilityIds?.length ?? 0) > 0 ||
    selectedStatusIds.length > 0 ||
    Boolean(selectedRegionId);

  const statusSet = new Set(selectedStatusIds);
  const facilityIdSet = new Set(scope.facilityIds ?? []);

  const handleReset = useCallback(() => {
    setScope({
      dateRange: undefined,
      facilityIds: undefined,
    });
    onStatusChange?.([]);
    onRegionChange?.(undefined);
    onReset?.();
  }, [onRegionChange, onReset, onStatusChange, setScope]);

  const handleSaveView = useCallback(async () => {
    // TODO(ui-v2-s6): wire /api/v2/preferences — S3 stubs save-view to unblock shell work.
    setSaveState("saving");
    try {
      const stubbed = await stubbedSaveView({
        dashboardId,
        name: `View ${new Date().toISOString()}`,
        scope,
        statuses: selectedStatusIds,
        regionId: selectedRegionId,
      });
      console.info("[ui-v2-s3] stubbed save-view", stubbed);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }, [dashboardId, scope, selectedRegionId, selectedStatusIds]);

  return (
    <div
      role="toolbar"
      aria-label="Filter bar"
      data-active={hasActiveFilters || undefined}
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-end gap-3">
        <DateRangeField
          value={scope.dateRange}
          onChange={(next) => setScope({ dateRange: next })}
        />

        {facilities.length > 0 && (
          <MultiSelectField
            label="Facilities"
            options={facilities}
            selectedIds={facilityIdSet}
            onChange={(next) =>
              setScope({ facilityIds: next.length > 0 ? next : undefined })
            }
          />
        )}

        {regions.length > 0 && (
          <SingleSelectField
            label="Region"
            id={`filter-bar-${dashboardId}-region`}
            options={regions}
            value={selectedRegionId ?? ""}
            onChange={(value) => onRegionChange?.(value || undefined)}
          />
        )}

        {statuses.length > 0 && (
          <StatusChips
            statuses={statuses}
            selectedIds={statusSet}
            onChange={(ids) => onStatusChange?.(ids)}
          />
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {savedViews.length > 0 && (
            <SavedViewBadge count={savedViews.length} />
          )}
          <button
            type="button"
            onClick={handleReset}
            className="h-8 rounded-sm border border-border bg-surface-elevated px-3 text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSaveView();
            }}
            disabled={saveState === "saving"}
            className="h-8 rounded-sm border border-brand-primary bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : "Save view"}
          </button>
        </div>
      </div>
      <p
        aria-live="polite"
        className={cn(
          "text-xs",
          hasActiveFilters ? "text-warning" : "text-text-muted",
        )}
      >
        {hasActiveFilters
          ? "Filters active — results scoped to your selection."
          : "No filters active — showing default view."}
      </p>
    </div>
  );
}

function SavedViewBadge({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} saved views`}
      className="inline-flex h-8 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-xs font-medium text-text-secondary"
    >
      Saved views: {count}
    </span>
  );
}

type DateRangeValue = { start: string; end: string } | undefined;

function DateRangeField({
  value,
  onChange,
}: {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
        Date range
      </span>
      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label="Start date"
          value={value?.start ?? ""}
          onChange={(event) => {
            const start = event.target.value;
            if (!start && !value?.end) {
              onChange(undefined);
              return;
            }
            onChange({ start, end: value?.end ?? start });
          }}
          className="h-8 rounded-sm border border-border bg-surface px-2 text-sm text-text-primary focus-visible:border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        />
        <span className="text-xs text-text-muted">to</span>
        <input
          type="date"
          aria-label="End date"
          value={value?.end ?? ""}
          onChange={(event) => {
            const end = event.target.value;
            if (!end && !value?.start) {
              onChange(undefined);
              return;
            }
            onChange({ start: value?.start ?? end, end });
          }}
          className="h-8 rounded-sm border border-border bg-surface px-2 text-sm text-text-primary focus-visible:border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        />
      </div>
    </div>
  );
}

function MultiSelectField({
  label,
  options,
  selectedIds,
  onChange,
}: {
  label: string;
  options: FilterBarOption[];
  selectedIds: Set<string>;
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="text-xs font-semibold uppercase tracking-caps text-text-muted">
        {label}
      </legend>
      <div
        aria-label={label}
        className="flex max-w-md flex-wrap gap-1 rounded-sm border border-border bg-surface p-1"
      >
        {options.map((option) => {
          const checked = selectedIds.has(option.id);
          return (
            <label
              key={option.id}
              className={cn(
                "flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium",
                checked
                  ? "border-brand-primary bg-surface-elevated text-text-primary"
                  : "border-border bg-surface text-text-secondary",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const nextSet = new Set(selectedIds);
                  if (event.target.checked) nextSet.add(option.id);
                  else nextSet.delete(option.id);
                  onChange(Array.from(nextSet));
                }}
                className="h-3 w-3 accent-brand-primary"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SingleSelectField({
  label,
  id,
  options,
  value,
  onChange,
}: {
  label: string;
  id: string;
  options: FilterBarOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-caps text-text-muted"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-40 rounded-sm border border-border bg-surface px-2 text-sm text-text-primary focus-visible:border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
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

function StatusChips({
  statuses,
  selectedIds,
  onChange,
}: {
  statuses: FilterBarOption[];
  selectedIds: Set<string>;
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
        Status
      </span>
      <div role="group" aria-label="Status" className="flex flex-wrap gap-1">
        {statuses.map((status) => {
          const checked = selectedIds.has(status.id);
          return (
            <button
              key={status.id}
              type="button"
              aria-pressed={checked}
              onClick={() => {
                const nextSet = new Set(selectedIds);
                if (checked) nextSet.delete(status.id);
                else nextSet.add(status.id);
                onChange(Array.from(nextSet));
              }}
              className={cn(
                "h-7 rounded-sm border px-2 text-xs font-semibold",
                checked
                  ? "border-brand-primary bg-brand-primary text-text-inverse"
                  : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary",
              )}
            >
              {status.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

async function stubbedSaveView(payload: {
  dashboardId: string;
  name: string;
  scope: Scope;
  statuses: string[];
  regionId: string | undefined;
}): Promise<SaveViewResult> {
  // TODO(ui-v2-s6): wire /api/v2/preferences — real persistence lands in S6.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    success: true,
    savedViewId: `stub-${payload.dashboardId}-${Date.now()}`,
  };
}
