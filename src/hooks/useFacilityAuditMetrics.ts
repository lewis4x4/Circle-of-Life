"use client";

import { useCallback, useEffect, useState } from "react";

export interface FacilityAuditMetricsPayload {
  events_last_7d: number;
  events_all_time: number;
  last_event_at: string | null;
  top_user_display: string | null;
  retention_years: number;
}

export function useFacilityAuditMetrics(facilityId: string, enabled = true): {
  data: FacilityAuditMetricsPayload | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<FacilityAuditMetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || !facilityId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/audit-log/metrics`);
      if (!res.ok) throw new Error("Failed to fetch audit metrics");
      const json = (await res.json()) as FacilityAuditMetricsPayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Metrics error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, facilityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
