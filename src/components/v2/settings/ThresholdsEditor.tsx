"use client";

import { useState } from "react";

import type {
  V2ThresholdLoad,
  V2ThresholdRow,
} from "@/lib/v2-thresholds-types";
import { V2_THRESHOLD_METRIC_CATALOG } from "@/lib/v2-thresholds-types";
import { cn } from "@/lib/utils";

type DraftThreshold = {
  metricKey: string;
  targetValue: string;
  direction: "up" | "down";
  warningBandPct: string;
  // local row state
  saving: boolean;
  saved?: boolean;
  error?: string | null;
  /** True if this row was added in this session (no DB row yet). */
  pristine: boolean;
};

function thresholdsByFacility(load: V2ThresholdLoad): Map<string, V2ThresholdRow[]> {
  const out = new Map<string, V2ThresholdRow[]>();
  for (const row of load.thresholds) {
    const list = out.get(row.facilityId) ?? [];
    list.push(row);
    out.set(row.facilityId, list);
  }
  return out;
}

function buildDraftMap(load: V2ThresholdLoad): Record<string, Record<string, DraftThreshold>> {
  const map: Record<string, Record<string, DraftThreshold>> = {};
  const grouped = thresholdsByFacility(load);
  for (const facility of load.facilities) {
    const live = grouped.get(facility.id) ?? [];
    const inner: Record<string, DraftThreshold> = {};
    for (const metric of V2_THRESHOLD_METRIC_CATALOG) {
      const existing = live.find((r) => r.metricKey === metric.key);
      inner[metric.key] = {
        metricKey: metric.key,
        targetValue: existing ? String(existing.targetValue) : "",
        direction: existing ? existing.direction : metric.defaultDirection,
        warningBandPct: existing ? String(existing.warningBandPct) : "10",
        saving: false,
        saved: false,
        error: null,
        pristine: !existing,
      };
    }
    map[facility.id] = inner;
  }
  return map;
}

export function ThresholdsEditor({ load }: { load: V2ThresholdLoad }) {
  const [drafts, setDrafts] = useState<Record<string, Record<string, DraftThreshold>>>(
    () => buildDraftMap(load),
  );

  const updateDraft = (
    facilityId: string,
    metricKey: string,
    patch: Partial<DraftThreshold>,
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [facilityId]: {
        ...prev[facilityId],
        [metricKey]: { ...prev[facilityId]![metricKey]!, ...patch },
      },
    }));
  };

  const save = async (
    facility: V2ThresholdLoad["facilities"][number],
    metricKey: string,
  ) => {
    const draft = drafts[facility.id]?.[metricKey];
    if (!draft) return;
    const targetValue = Number(draft.targetValue);
    const warningBandPct = Number(draft.warningBandPct);
    if (!Number.isFinite(targetValue)) {
      updateDraft(facility.id, metricKey, { error: "Target must be a number" });
      return;
    }
    if (!Number.isFinite(warningBandPct) || warningBandPct < 0) {
      updateDraft(facility.id, metricKey, { error: "Band must be ≥ 0" });
      return;
    }

    updateDraft(facility.id, metricKey, { saving: true, error: null, saved: false });
    try {
      const response = await fetch(`/api/v2/thresholds/${facility.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: facility.organizationId,
          metricKey,
          targetValue,
          direction: draft.direction,
          warningBandPct,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${response.status})`);
      }
      updateDraft(facility.id, metricKey, {
        saving: false,
        saved: true,
        error: null,
        pristine: false,
      });
    } catch (err) {
      updateDraft(facility.id, metricKey, {
        saving: false,
        error: err instanceof Error ? err.message : "Save failed",
      });
    }
  };

  if (load.facilities.length === 0) {
    return (
      <p className="text-xs text-text-muted">
        No facilities are visible to your account under RLS — nothing to threshold.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {load.facilities.map((facility) => (
        <section
          key={facility.id}
          aria-label={`Thresholds for ${facility.name}`}
          className="rounded-md border border-border bg-surface"
        >
          <header className="border-b border-border px-4 py-2">
            <h3 className="text-sm font-semibold text-text-primary">{facility.name}</h3>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-elevated">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Metric</th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-caps text-text-muted">Target</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Direction</th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-caps text-text-muted">Warn band %</th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-caps text-text-muted">Save</th>
                </tr>
              </thead>
              <tbody>
                {V2_THRESHOLD_METRIC_CATALOG.map((metric) => {
                  const draft = drafts[facility.id]?.[metric.key];
                  if (!draft) return null;
                  return (
                    <tr key={`${facility.id}:${metric.key}`} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2">
                        <span className="text-sm font-medium text-text-primary">{metric.label}</span>
                        {metric.unit && (
                          <span aria-hidden="true" className="ml-1 text-xs text-text-muted">{metric.unit}</span>
                        )}
                        {draft.pristine && (
                          <span className="ml-2 inline-flex items-center rounded-sm border border-info px-1.5 py-0.5 text-xs font-semibold text-info">new</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <label className="sr-only" htmlFor={`target-${facility.id}-${metric.key}`}>
                          {`Target value for ${metric.label} at ${facility.name}`}
                        </label>
                        <input
                          id={`target-${facility.id}-${metric.key}`}
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          value={draft.targetValue}
                          onChange={(e) => updateDraft(facility.id, metric.key, { targetValue: e.target.value })}
                          className="h-8 w-24 rounded-sm border border-border bg-surface px-2 text-right text-sm text-text-primary tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`direction-${facility.id}-${metric.key}`}>
                          {`Direction for ${metric.label} at ${facility.name}`}
                        </label>
                        <select
                          id={`direction-${facility.id}-${metric.key}`}
                          value={draft.direction}
                          onChange={(e) => updateDraft(facility.id, metric.key, { direction: e.target.value as "up" | "down" })}
                          className="h-8 rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
                        >
                          <option value="up">↑ higher is better</option>
                          <option value="down">↓ lower is better</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <label className="sr-only" htmlFor={`band-${facility.id}-${metric.key}`}>
                          {`Warning band % for ${metric.label} at ${facility.name}`}
                        </label>
                        <input
                          id={`band-${facility.id}-${metric.key}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="1"
                          value={draft.warningBandPct}
                          onChange={(e) => updateDraft(facility.id, metric.key, { warningBandPct: e.target.value })}
                          className="h-8 w-20 rounded-sm border border-border bg-surface px-2 text-right text-sm text-text-primary tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            void save(facility, metric.key);
                          }}
                          disabled={draft.saving}
                          className="inline-flex h-7 items-center rounded-sm border border-brand-primary bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {draft.saving ? "Saving…" : draft.saved ? "Saved" : "Save"}
                        </button>
                        {draft.error && (
                          <p
                            role="alert"
                            className={cn(
                              "mt-1 text-xs text-danger",
                            )}
                          >
                            {draft.error}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
