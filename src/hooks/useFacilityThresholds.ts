"use client";

import { useCallback, useEffect, useState } from "react";
import type { ThresholdInput } from "@/lib/validation/facility-admin";

export interface ThresholdRow {
  id: string;
  threshold_type: string;
  yellow_threshold: number;
  red_threshold: number;
  notify_roles: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function useFacilityThresholds(facilityId: string) {
  const [thresholds, setThresholds] = useState<ThresholdRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/thresholds`);
      if (!res.ok) throw new Error("Failed to load thresholds");
      const json = (await res.json()) as { data: ThresholdRow[] };
      setThresholds(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setThresholds([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  /** Bulk replace: send full array of threshold rows (with id when updating). */
  const saveThresholds = useCallback(
    async (rows: Array<ThresholdInput & { id?: string }>) => {
      setIsSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}/thresholds`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rows),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? "Save failed");
        }
        await refetch();
      } finally {
        setIsSaving(false);
      }
    },
    [facilityId, refetch],
  );

  return { thresholds, isLoading, error, refetch, saveThresholds, isSaving };
}
