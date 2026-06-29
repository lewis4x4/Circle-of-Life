"use client";

import { useCallback, useEffect, useState } from "react";
import type { ThresholdInput } from "@/lib/validation/facility-admin";
import type { OrgDefaultRow } from "@/lib/admin/facilities/operational-threshold-preview";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";

export interface ThresholdRow {
  id: string;
  threshold_type: string;
  yellow_threshold: number;
  red_threshold: number;
  notify_roles: string[];
  enabled: boolean;
  alert_frequency: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  updated_by_display: string | null;
}

type ThresholdsApiEnvelope = {
  data: Array<{
    id: string;
    threshold_type: string;
    yellow_threshold: number | string;
    red_threshold: number | string;
    notify_roles: string[];
    enabled: boolean;
    alert_frequency?: string | null;
    created_at: string;
    updated_at: string;
    updated_by?: string | null;
    updated_by_display?: string | null;
  }>;
  org_defaults: Array<{
    threshold_type: string;
    yellow_threshold: number | string;
    red_threshold: number | string;
    notify_roles: string[];
    alert_frequency?: string | null;
  }>;
};

function mapRow(r: ThresholdsApiEnvelope["data"][number]): ThresholdRow {
  return {
    id: r.id,
    threshold_type: r.threshold_type,
    yellow_threshold: Number(r.yellow_threshold),
    red_threshold: Number(r.red_threshold),
    notify_roles: r.notify_roles ?? [],
    enabled: Boolean(r.enabled),
    alert_frequency: r.alert_frequency ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    updated_by: r.updated_by ?? null,
    updated_by_display: r.updated_by_display ?? null,
  };
}

function mapOrg(o: ThresholdsApiEnvelope["org_defaults"][number]): OrgDefaultRow {
  return {
    threshold_type: o.threshold_type,
    yellow_threshold: Number(o.yellow_threshold),
    red_threshold: Number(o.red_threshold),
    notify_roles: o.notify_roles ?? [],
    alert_frequency: o.alert_frequency ?? null,
  };
}

export function useFacilityThresholds(facilityId: string, options?: { enabled?: boolean }) {
  const gated = options?.enabled ?? true;
  const [thresholds, setThresholds] = useState<ThresholdRow[]>([]);
  const [orgDefaults, setOrgDefaults] = useState<OrgDefaultRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/thresholds`);
      if (!res.ok) throw new Error("Failed to load thresholds");
      const json = (await res.json()) as ThresholdsApiEnvelope;
      setThresholds((json.data ?? []).map(mapRow));
      setOrgDefaults((json.org_defaults ?? []).map(mapOrg));
    } catch (err) {
      setError(formatLiveDataLoadError(err, "Facility thresholds are unavailable right now."));
      setThresholds([]);
      setOrgDefaults([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    if (!gated || !facilityId) {
      setIsLoading(false);
      return;
    }
    void refetch();
  }, [gated, facilityId, refetch]);

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

  return { thresholds, orgDefaults, isLoading, error, refetch, saveThresholds, isSaving };
}
