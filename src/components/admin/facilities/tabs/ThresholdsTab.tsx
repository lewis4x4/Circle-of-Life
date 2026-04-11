"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFacilityThresholds, type ThresholdRow } from "@/hooks/useFacilityThresholds";
import { THRESHOLD_TYPE_LABELS } from "@/lib/admin/facilities/facility-constants";
import type { ThresholdInput } from "@/lib/validation/facility-admin";

interface ThresholdsTabProps {
  facilityId: string;
}

export function ThresholdsTab({ facilityId }: ThresholdsTabProps) {
  const { thresholds, isLoading, error, saveThresholds, isSaving } = useFacilityThresholds(facilityId);
  const [local, setLocal] = useState<ThresholdRow[]>([]);

  useEffect(() => {
    setLocal(thresholds);
  }, [thresholds]);

  function updateRow(id: string, patch: Partial<ThresholdRow>) {
    setLocal((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function onSave() {
    const payload = local.map((r) => {
      const row: ThresholdInput & { id?: string } = {
        id: r.id,
        threshold_type: r.threshold_type as ThresholdInput["threshold_type"],
        yellow_threshold: Number(r.yellow_threshold),
        red_threshold: Number(r.red_threshold),
        notify_roles: r.notify_roles,
        enabled: r.enabled,
      };
      return row;
    });
    await saveThresholds(payload);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Yellow / red thresholds drive compliance-style alerts. Values are numeric (days, counts, or % — see type).
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200/50 dark:border-white/10 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50/50 dark:bg-white/5 text-left">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Yellow</th>
              <th className="px-3 py-2">Red</th>
              <th className="px-3 py-2">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {local.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 align-top">
                  {THRESHOLD_TYPE_LABELS[r.threshold_type as keyof typeof THRESHOLD_TYPE_LABELS] ?? r.threshold_type}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="w-24 rounded border px-2 py-1"
                    value={r.yellow_threshold}
                    onChange={(e) => updateRow(r.id, { yellow_threshold: Number(e.target.value) })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="w-24 rounded border px-2 py-1"
                    value={r.red_threshold}
                    onChange={(e) => updateRow(r.id, { red_threshold: Number(e.target.value) })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => updateRow(r.id, { enabled: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={isSaving || local.length === 0}
        className="rounded-[1.5rem] bg-teal-600 px-6 py-2 text-white disabled:opacity-50"
      >
        {isSaving ? "Saving…" : "Save thresholds"}
      </button>
    </div>
  );
}
