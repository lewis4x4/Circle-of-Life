"use client";

import { useCallback, useEffect, useState } from "react";
import type { DocumentVaultKpiPayload } from "@/lib/admin/facilities/document-vault-kpi";

export function useFacilityDocumentVaultMetrics(facilityId: string, enabled: boolean) {
  const [kpi, setKpi] = useState<DocumentVaultKpiPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || !facilityId) {
      setKpi(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/documents/metrics`);
      if (!res.ok) throw new Error("Failed to load document metrics");
      const json = (await res.json()) as { data: DocumentVaultKpiPayload };
      setKpi(json.data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setError(msg);
      setKpi(null);
    } finally {
      setLoading(false);
    }
  }, [facilityId, enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { kpi, loading, error, refetch };
}
