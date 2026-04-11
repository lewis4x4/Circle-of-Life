"use client";

import { useState, useCallback, useEffect } from "react";
import type { FacilityDetailRow, FacilityRow } from "@/types/facility";

function normalizeFacilityDetail(raw: Record<string, unknown>): FacilityDetailRow {
  const f = raw as FacilityDetailRow & { license_number?: string | null };
  const entity = f.entity ?? null;
  const entityName =
    f.entity_name ??
    entity?.legal_name ??
    entity?.dba_name ??
    null;
  const occ = f.occupancy_count ?? f.current_occupancy ?? 0;
  const beds = f.total_beds ?? f.licensed_beds ?? f.total_licensed_beds ?? 0;
  return {
    ...f,
    entity_name: entityName,
    current_occupancy: occ,
    licensed_beds: beds,
    ahca_license_number: f.ahca_license_number ?? f.license_number ?? null,
  } as FacilityDetailRow;
}

interface UseFacilityReturn {
  facility: FacilityDetailRow | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateFacility: (updates: Partial<FacilityRow>) => Promise<FacilityDetailRow | null>;
  isUpdating: boolean;
}

export function useFacility(facilityId: string): UseFacilityReturn {
  const [facility, setFacility] = useState<FacilityDetailRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (showLoading: boolean): Promise<FacilityDetailRow | null> => {
      if (showLoading) setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}`);
        if (!res.ok) {
          throw new Error("Failed to fetch facility");
        }
        const json = (await res.json()) as { data: Record<string, unknown> };
        const n = normalizeFacilityDetail(json.data);
        setFacility(n);
        return n;
      } catch (err) {
        console.error("[useFacility] fetch error:", err);
        const message = err instanceof Error ? err.message : "Failed to fetch facility";
        setError(message);
        setFacility(null);
        return null;
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [facilityId],
  );

  const refetch = useCallback(async () => {
    await loadDetail(true);
  }, [loadDetail]);

  const updateFacility = useCallback(
    async (updates: Partial<FacilityRow>): Promise<FacilityDetailRow | null> => {
      setIsUpdating(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          throw new Error("Failed to update facility");
        }
        return await loadDetail(false);
      } catch (err) {
        console.error("[useFacility] update error:", err);
        const message = err instanceof Error ? err.message : "Failed to update facility";
        setError(message);
        return null;
      } finally {
        setIsUpdating(false);
      }
    },
    [facilityId, loadDetail],
  );

  useEffect(() => {
    void loadDetail(true);
  }, [loadDetail]);

  return {
    facility,
    isLoading,
    error,
    refetch,
    updateFacility,
    isUpdating,
  };
}
